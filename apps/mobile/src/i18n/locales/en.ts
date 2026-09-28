/** Workers are called "Rangers" in every user-facing string (docs/DECISIONS.md D-003). */
const en = {
  app: { name: 'Haggler' },
  tabs: { home: 'Services', settings: 'Settings' },
  home: {
    title: 'What do you need help with?',
    subtitle: 'Verified Rangers near you',
  },
  states: {
    loading: 'Loading…',
    error: 'Could not load this. Check your connection.',
    empty: 'Nothing here yet.',
    retry: 'Try again',
  },
  categories: {
    electrician: 'Electrician',
    plumber: 'Plumber',
    cleaner: 'Cleaner',
    carpenter: 'Carpenter',
    appliance_repair: 'Appliance repair',
    ac_repair: 'AC repair',
    painter: 'Painter',
    pest_control: 'Pest control',
    gas_appliance_repair: 'Gas appliance repair',
  },
  settings: {
    title: 'Settings',
    appearance: 'Appearance',
    theme: { system: 'Match device', light: 'Light', dark: 'Dark' },
    language: 'Language',
    languageDevice: 'Match device',
    environment: 'Server status',
    apiOk: 'Connected',
    apiDegraded: 'Connected (some services degraded)',
    apiDown: 'Cannot reach the server',
    adapterSandbox: 'test mode',
    adapterLive: 'live',
    adapters: {
      sms: 'SMS',
      kyc: 'Identity checks',
      payments: 'Payments',
      calls: 'Masked calls',
      push: 'Notifications',
      maps: 'Maps',
    },
  },
} as const;

export type DeepString<T> = { [K in keyof T]: T[K] extends string ? string : DeepString<T[K]> };
export type Translation = DeepString<typeof en>;
export default en;
