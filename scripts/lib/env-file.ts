export function upsertEnvLine(content: string, key: string, value: string): string {
  const linePattern = new RegExp(`^${key}=(.*)$`, "m");
  const match = content.match(linePattern);
  if (match) {
    if (match[1].trim() !== "") throw new Error(`${key} is already set; refusing to overwrite it`);
    return content.replace(linePattern, `${key}=${value}`);
  }
  const separator = content === "" || content.endsWith("\n") ? "" : "\n";
  return `${content}${separator}${key}=${value}\n`;
}
