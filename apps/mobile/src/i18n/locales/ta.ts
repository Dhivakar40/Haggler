import type { Translation } from './en';

// Draft translation. Needs review by a native speaker before launch (docs/COMPLIANCE.md).
const ta: Translation = {
  app: { name: 'ஹேக்லர்' },
  tabs: { home: 'சேவைகள்', settings: 'அமைப்புகள்' },
  home: {
    title: 'உங்களுக்கு என்ன உதவி வேண்டும்?',
    subtitle: 'உங்கள் அருகிலுள்ள சரிபார்க்கப்பட்ட ரேஞ்சர்கள்',
  },
  states: {
    loading: 'ஏற்றுகிறது…',
    error: 'ஏற்ற முடியவில்லை. இணைப்பைச் சரிபார்க்கவும்.',
    empty: 'இங்கே இன்னும் எதுவும் இல்லை.',
    retry: 'மீண்டும் முயற்சிக்கவும்',
  },
  categories: {
    electrician: 'எலக்ட்ரீசியன்',
    plumber: 'பிளம்பர்',
    cleaner: 'சுத்தம் செய்பவர்',
    carpenter: 'தச்சர்',
    appliance_repair: 'வீட்டு உபயோகப் பொருள் பழுது',
    ac_repair: 'ஏசி பழுது',
    painter: 'பெயிண்டர்',
    pest_control: 'பூச்சி கட்டுப்பாடு',
    gas_appliance_repair: 'கேஸ் சாதன பழுது',
  },
  settings: {
    title: 'அமைப்புகள்',
    appearance: 'தோற்றம்',
    theme: { system: 'சாதனத்தைப் பின்பற்று', light: 'வெளிச்சம்', dark: 'இருள்' },
    language: 'மொழி',
    languageDevice: 'சாதனத்தைப் பின்பற்று',
    environment: 'சர்வர் நிலை',
    apiOk: 'இணைக்கப்பட்டது',
    apiDegraded: 'இணைக்கப்பட்டது (சில சேவைகள் மெதுவாக உள்ளன)',
    apiDown: 'சர்வரை அடைய முடியவில்லை',
    adapterSandbox: 'சோதனை முறை',
    adapterLive: 'நேரடி',
    adapters: {
      sms: 'எஸ்எம்எஸ்',
      kyc: 'அடையாளச் சரிபார்ப்பு',
      payments: 'பணம் செலுத்துதல்',
      calls: 'பாதுகாப்பான அழைப்புகள்',
      push: 'அறிவிப்புகள்',
      maps: 'வரைபடங்கள்',
    },
  },
};
export default ta;
