# Synthetic Agent Integration Spec

Goal: let external coding agents use local project evidence without turning Ragmir into another chat
memory system.

Ragmir complements agent memory. It does not replace the agent conversation state, task plan, or
native code index. The agent keeps its normal reasoning loop, then calls Ragmir when it needs cited
evidence from local documents such as contracts, RFPs, runbooks, or specs.

The MCP surface stays read-focused and bounded by topK. This is a security advantage: agents receive
verifiable passages and audit data without gaining a broad document mutation channel.
