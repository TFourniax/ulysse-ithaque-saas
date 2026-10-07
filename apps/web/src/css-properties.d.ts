import 'react';

// Lets components pass CSS custom properties (e.g. `--value`) through the typed `style` prop.
// React applies them through the CSSOM, which the API's `style-src 'self'` policy allows.
declare module 'react' {
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}
