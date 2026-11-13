export function signingLink(token: string): string {
 main
  return `${window.location.origin}/sign/${encodeURIComponent(token)}`;
}
