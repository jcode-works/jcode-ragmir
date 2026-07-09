# Synthetic RFP Security Questionnaire

Question: Does the proposed retrieval layer require a hosted account, product telemetry, or broad
write access to the repository?

Answer: No hosted account is required. The default mode runs locally with no telemetry. MCP access is
read-focused: the agent can ask for status, prompt-routing advice, search results, cited answers,
audits, evaluation results, usage summaries, and security posture, but it does not receive a
destructive repository tool from Ragmir.

Follow-up: customer-specific evidence stays on disk and is reviewed by a human before an RFP response
is sent.
