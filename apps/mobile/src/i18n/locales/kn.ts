import type { Translation } from './en';

// Draft translation. Needs review by a native speaker before launch (docs/COMPLIANCE.md).
const kn: Translation = {
  app: { name: 'ಹ್ಯಾಗ್ಲರ್' },
  tabs: { home: 'ಸೇವೆಗಳು', settings: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು' },
  home: {
    title: 'ನಿಮಗೆ ಯಾವ ಸಹಾಯ ಬೇಕು?',
    subtitle: 'ನಿಮ್ಮ ಹತ್ತಿರದ ಪರಿಶೀಲಿತ ರೇಂಜರ್‌ಗಳು',
  },
  states: {
    loading: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…',
    error: 'ಲೋಡ್ ಮಾಡಲಾಗಲಿಲ್ಲ. ನಿಮ್ಮ ಸಂಪರ್ಕವನ್ನು ಪರಿಶೀಲಿಸಿ.',
    empty: 'ಇಲ್ಲಿ ಇನ್ನೂ ಏನೂ ಇಲ್ಲ.',
    retry: 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ',
  },
  categories: {
    electrician: 'ಎಲೆಕ್ಟ್ರೀಷಿಯನ್',
    plumber: 'ಪ್ಲಂಬರ್',
    cleaner: 'ಸ್ವಚ್ಛತೆ',
    carpenter: 'ಬಡಗಿ',
    appliance_repair: 'ಗೃಹೋಪಕರಣ ದುರಸ್ತಿ',
    ac_repair: 'ಎಸಿ ದುರಸ್ತಿ',
    painter: 'ಪೇಂಟರ್',
    pest_control: 'ಕೀಟ ನಿಯಂತ್ರಣ',
    gas_appliance_repair: 'ಗ್ಯಾಸ್ ಉಪಕರಣ ದುರಸ್ತಿ',
  },
  settings: {
    title: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
    appearance: 'ಗೋಚರತೆ',
    theme: { system: 'ಸಾಧನದಂತೆ', light: 'ಬೆಳಕು', dark: 'ಕತ್ತಲೆ' },
    language: 'ಭಾಷೆ',
    languageDevice: 'ಸಾಧನದಂತೆ',
    environment: 'ಸರ್ವರ್ ಸ್ಥಿತಿ',
    apiOk: 'ಸಂಪರ್ಕಗೊಂಡಿದೆ',
    apiDegraded: 'ಸಂಪರ್ಕಗೊಂಡಿದೆ (ಕೆಲವು ಸೇವೆಗಳು ನಿಧಾನವಾಗಿವೆ)',
    apiDown: 'ಸರ್ವರ್ ತಲುಪಲು ಸಾಧ್ಯವಾಗುತ್ತಿಲ್ಲ',
    adapterSandbox: 'ಪರೀಕ್ಷಾ ಮೋಡ್',
    adapterLive: 'ಲೈವ್',
    adapters: {
      sms: 'ಎಸ್‌ಎಂಎಸ್',
      kyc: 'ಗುರುತಿನ ಪರಿಶೀಲನೆ',
      payments: 'ಪಾವತಿಗಳು',
      calls: 'ಸುರಕ್ಷಿತ ಕರೆಗಳು',
      push: 'ಅಧಿಸೂಚನೆಗಳು',
      maps: 'ನಕ್ಷೆಗಳು',
    },
  },
};
export default kn;
