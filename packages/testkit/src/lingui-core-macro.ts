/**
 * The Lingui macro compiles away in the app build; tests run the source, so `t` just renders the
 * English template.
 */
export function t(strings: TemplateStringsArray, ...values: unknown[]): string {
  return String.raw(strings, ...values);
}

/** The English plural: `#` is the count. */
export function plural(
  count: number,
  forms: { one: string; other: string; [key: string]: string },
): string {
  return (count === 1 ? forms.one : forms.other).replace("#", String(count));
}
