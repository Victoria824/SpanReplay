import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parseAllDocuments } from "yaml";

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(candidate) : Promise.resolve([candidate]);
  }))).flat();
}

const files = await filesUnder("infrastructure");
const workflowFiles = (await filesUnder(".github/workflows")).filter((file) => /\.ya?ml$/.test(file));
const observabilityFiles = (await filesUnder("observability")).filter((file) => /\.ya?ml$/.test(file));
const yamlFiles = ["docker-compose.yml", "docker-compose.datadog.yml", ...workflowFiles, ...observabilityFiles, ...files.filter((file) => /\.ya?ml$/.test(file))];
for (const file of yamlFiles) {
  const source = await readFile(file, "utf8");
  const documents = parseAllDocuments(source);
  const errors = documents.flatMap((document) => document.errors);
  if (errors.length) throw new Error(`${file}: ${errors.map((error) => error.message).join("; ")}`);
  if (/infrastructure\/kubernetes\/.+\.ya?ml$/.test(file) && !file.endsWith("kustomization.yaml")) {
    for (const document of documents) {
      const value = document.toJS() as { apiVersion?: string; kind?: string; metadata?: { name?: string } } | null;
      if (!value) continue;
      if (!value.apiVersion || !value.kind || !value.metadata?.name) {
        throw new Error(`${file}: Kubernetes document is missing apiVersion, kind, or metadata.name`);
      }
    }
  }
  if (!file.endsWith(".example.yaml") && source.includes("REPLACE_WITH")) {
    throw new Error(`${file}: unresolved deployment placeholder`);
  }
  console.log(`PASS YAML ${file}`);
}

for (const file of files.filter((candidate) => candidate.endsWith(".tf"))) {
  const source = await readFile(file, "utf8");
  let depth = 0;
  for (const character of source) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth < 0) throw new Error(`${file}: unmatched closing brace`);
  }
  if (depth !== 0) throw new Error(`${file}: unbalanced braces`);
  console.log(`PASS HCL STRUCTURE ${file}`);
}

const production = await readFile("infrastructure/kubernetes/overlays/production/availability.yaml", "utf8");
for (const required of ["HorizontalPodAutoscaler", "PodDisruptionBudget"]) {
  if (!production.includes(`kind: ${required}`)) throw new Error(`production overlay has no ${required}`);
}
const aws = (await Promise.all(files.filter((file) => /terraform\/aws\/.+\.tf$/.test(file)).map((file) => readFile(file, "utf8")))).join("\n");
for (const resource of ["aws_s3_bucket", "aws_kms_key", "aws_iam_role", "aws_ecr_repository"]) {
  if (!aws.includes(`resource "${resource}"`)) throw new Error(`AWS Terraform has no ${resource}`);
}
const awsBootstrap = (await Promise.all(files.filter((file) => /terraform\/aws-bootstrap\/.+\.tf$/.test(file)).map((file) => readFile(file, "utf8")))).join("\n");
for (const resource of ["aws_iam_openid_connect_provider", "aws_s3_bucket", "aws_iam_role", "aws_eks_access_entry"]) {
  if (!awsBootstrap.includes(`resource "${resource}"`)) throw new Error(`AWS bootstrap Terraform has no ${resource}`);
}
if (!awsBootstrap.includes("token.actions.githubusercontent.com:sub")) throw new Error("AWS bootstrap does not constrain GitHub OIDC subjects");
const datadog = (await Promise.all(files.filter((file) => /terraform\/datadog\/.+\.tf$/.test(file)).map((file) => readFile(file, "utf8")))).join("\n");
for (const resource of ["datadog_monitor", "datadog_logs_custom_pipeline", "datadog_service_level_objective", "datadog_dashboard_json"]) {
  if (!datadog.includes(`resource "${resource}"`)) throw new Error(`Datadog Terraform has no ${resource}`);
}
console.log("INFRASTRUCTURE STATIC VALIDATION PASSED");
