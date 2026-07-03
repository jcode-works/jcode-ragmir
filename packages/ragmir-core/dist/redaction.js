const BUILT_IN_PATTERNS = [
    {
        name: "private_key",
        pattern: "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----",
        flags: "g",
    },
    {
        name: "jwt",
        pattern: "\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b",
        flags: "g",
    },
    {
        name: "api_token",
        pattern: "\\b(?:sk|pk|ghp|gho|github_pat|npm)_[A-Za-z0-9_=-]{20,}\\b|\\b[A-Za-z0-9_-]{32,}\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}\\b",
        flags: "g",
    },
    {
        name: "openai_api_key",
        pattern: "\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\\b",
        flags: "g",
    },
    {
        name: "aws_access_key_id",
        pattern: "\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b",
        flags: "g",
    },
    {
        name: "google_api_key",
        pattern: "\\bAIza[0-9A-Za-z_-]{35}\\b",
        flags: "g",
    },
    {
        name: "slack_token",
        pattern: "\\bxox[baprs]-[0-9A-Za-z-]{10,}\\b",
        flags: "g",
    },
    {
        name: "sendgrid_api_key",
        pattern: "\\bSG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}\\b",
        flags: "g",
    },
    {
        name: "url_credentials",
        pattern: "\\b[a-z][a-z0-9+.-]*://[^\\s:/@]+:[^\\s/@]+@",
        flags: "gi",
    },
    {
        name: "email",
        pattern: "\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b",
        flags: "gi",
    },
    {
        name: "iban",
        pattern: "\\b[A-Z]{2}\\d{2}[A-Z0-9]{11,30}\\b",
        flags: "gi",
    },
    {
        name: "credit_card",
        pattern: "\\b(?:\\d[ -]*?){13,19}\\b",
        flags: "g",
    },
];
export function redactText(input, config) {
    if (!config.redaction.enabled) {
        return { text: input, counts: [] };
    }
    let text = input;
    const counts = [];
    const patterns = [
        ...(config.redaction.builtIn ? BUILT_IN_PATTERNS : []),
        ...config.redaction.patterns,
    ];
    for (const pattern of patterns) {
        const regexp = compilePattern(pattern);
        let count = 0;
        text = text.replace(regexp, () => {
            count += 1;
            return pattern.replacement ?? `[REDACTED_${pattern.name.toUpperCase()}]`;
        });
        if (count > 0) {
            counts.push({ name: pattern.name, count });
        }
    }
    return { text, counts };
}
export function totalRedactions(counts) {
    return counts.reduce((total, entry) => total + entry.count, 0);
}
function compilePattern(pattern) {
    const flags = pattern.flags?.includes("g") ? pattern.flags : `${pattern.flags ?? ""}g`;
    return new RegExp(pattern.pattern, flags);
}
//# sourceMappingURL=redaction.js.map