import type { CrmNumberFormat, Money } from '@ulysse/domain';
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

/** Parse display strings without rounding or guessing an ambiguous decimal/group separator. */
export function crmMoney(
  raw: string,
  options: {
    fieldCurrency?: string;
    heading: string;
    defaultCurrency?: string;
    override?: string;
    format: CrmNumberFormat;
  },
): { money?: Money; error?: string; usedDefault?: boolean } {
  let value = raw.trim();
  const codes: string[] = [];
  const currencyCode = (s: string) => {
    const t = s.trim().toUpperCase();
    return /^(€|EUROS?)$/.test(t) ? 'EUR' : t;
  };
  const field = options.fieldCurrency ? currencyCode(options.fieldCurrency) : '';
  if (field) codes.push(field);
  if (options.heading.includes('€')) codes.push('EUR');
  if (/\bEUR\b/i.test(options.heading)) codes.push('EUR');
  value = value
    .replace(
      /^(EUR|USD|GBP|CHF|CAD|AUD|JPY|[A-Z]{3})\s+|\s*(EUR|USD|GBP|CHF|CAD|AUD|JPY|[A-Z]{3})$/gi,
      (s) => {
        codes.push(currencyCode(s));
        return '';
      },
    )
    .trim();
  const hasDollar = value.includes('$');
  for (const [symbol, code] of [
    ['€', 'EUR'],
    ['£', 'GBP'],
  ] as const) {
    if (value.includes(symbol)) codes.push(code);
  }
  value = value.replace(/^[€£$]\s*|\s*[€£$]$/g, '').trim();
  const distinct = [...new Set(codes)];
  const currency = (options.override || distinct[0] || options.defaultCurrency || '').toUpperCase();
  if (
    (!options.override && distinct.length > 1) ||
    !CURRENCIES.has(currency) ||
    (hasDollar && !['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD'].includes(currency))
  )
    return {
      error:
        'Devise absente, inconnue ou contradictoire : choisissez une devise dans les corrections.',
    };

  const signed = value.startsWith('-');
  if (signed) value = value.slice(1);
  let decimal = '';
  let grouping = '';
  if (options.format === 'fr') {
    decimal = ',';
    grouping = '.';
  } else if (options.format === 'en') {
    decimal = '.';
    grouping = ',';
  } else if (value.includes(',') && value.includes('.')) {
    decimal = value.lastIndexOf(',') > value.lastIndexOf('.') ? ',' : '.';
    grouping = decimal === ',' ? '.' : ',';
  } else {
    const separator = value.includes(',') ? ',' : value.includes('.') ? '.' : '';
    if (separator) {
      const parts = value.split(separator);
      if (parts.length > 2) grouping = separator;
      else if (parts[1]?.length === 3 && /^\d{1,3}$/.test(parts[0] ?? ''))
        return {
          error:
            'Séparateur du montant ambigu : choisissez le format français ou anglais, ou corrigez ce montant.',
        };
      else decimal = separator;
    }
  }
  const parts = decimal ? value.split(decimal) : [value];
  if (parts.length > 2 || (parts.length === 2 && !/^\d{1,4}$/.test(parts[1] ?? '')))
    return {
      error:
        'Montant illisible : corrigez sa valeur ou laissez-le vide pour importer l’affaire sans montant.',
    };
  let integer = parts[0] ?? '';
  // Whitespace/apostrophes are thousands separators, never arbitrary characters to discard.
  if (/[^0-9]/.test(integer)) {
    const allowed =
      grouping === '.'
        ? '[.\\s\u00a0\u202f\u2019\x27]'
        : grouping === ','
          ? '[,\\s\u00a0\u202f\u2019\x27]'
          : '[\\s\u00a0\u202f\u2019\x27]';
    if (!new RegExp(`^\\d{1,3}(${allowed}\\d{3})+$`).test(integer))
      return {
        error:
          'Format du montant non reconnu : choisissez le format français ou anglais, ou corrigez sa valeur.',
      };
    integer = integer.replace(/[^0-9]/g, '');
  }
  if (!/^\d{1,15}$/.test(integer))
    return { error: 'Montant invalide : indiquez un nombre, ou laissez ce champ vide.' };
  return {
    money: {
      amount: `${signed ? '-' : ''}${integer}${parts.length === 2 ? `.${parts[1]}` : ''}`,
      currency,
    },
    usedDefault: !options.override && distinct.length === 0 && Boolean(options.defaultCurrency),
  };
}
