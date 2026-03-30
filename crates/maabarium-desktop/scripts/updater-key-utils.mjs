export function unwrapBase64WrappedMinisign(rawValue) {
  const normalized = rawValue
    .replace(/\r\n?/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();

  if (
    !normalized ||
    normalized.includes("\n") ||
    !/^[A-Za-z0-9+/=]+$/.test(normalized)
  ) {
    return normalized;
  }

  try {
    const decoded = Buffer.from(normalized, "base64").toString("utf8").trim();
    if (/^untrusted comment:/i.test(decoded)) {
      return decoded.replace(/\r\n?/g, "\n").replace(/\\n/g, "\n").trim();
    }
  } catch {
    return normalized;
  }

  return normalized;
}

export function normalizeMinisignText(rawValue, label) {
  const normalized = unwrapBase64WrappedMinisign(rawValue);
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0 || lines.length > 2) {
    throw new Error(
      `${label} must be either the raw minisign key line or the two-line key file contents.`,
    );
  }

  if (lines.length === 2 && !/^untrusted comment:/i.test(lines[0])) {
    throw new Error(
      `${label} contains two lines, but the first line is not the expected minisign comment header.`,
    );
  }

  if (lines.some((line) => /^-----BEGIN|^-----END/.test(line))) {
    throw new Error(
      `${label} looks like a PEM block instead of minisign key material.`,
    );
  }

  const keyLine = lines[lines.length - 1];
  if (!/^[A-Za-z0-9+/=]+$/.test(keyLine)) {
    throw new Error(`${label} is not valid base64 minisign key material.`);
  }

  return {
    normalizedLines: lines,
    keyLine,
    format:
      lines.length === 2
        ? normalized ===
          rawValue.replace(/\r\n?/g, "\n").replace(/\\n/g, "\n").trim()
          ? "two-line minisign file"
          : "base64-wrapped two-line minisign file"
        : "raw key line",
  };
}
