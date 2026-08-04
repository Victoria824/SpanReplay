variable "datadog_api_key" {
  description = "Datadog API key. Prefer TF_VAR_datadog_api_key over a tfvars file."
  type        = string
  sensitive   = true
}

variable "datadog_app_key" {
  description = "Datadog application key. Prefer TF_VAR_datadog_app_key over a tfvars file."
  type        = string
  sensitive   = true
}

variable "datadog_api_url" {
  description = "Datadog API endpoint for the selected site."
  type        = string
  default     = "https://api.datadoghq.com/"
}

variable "environment" {
  description = "Environment tag used by dashboards and monitors."
  type        = string
  default     = "production"
}

variable "notification_targets" {
  description = "Datadog handles such as @slack-ai-ops or @pagerduty-ai-platform."
  type        = list(string)
  default     = []
}

