import type { Translation } from './en';

// Draft translation. Needs review by a native speaker before launch (docs/COMPLIANCE.md).
const hi: Translation = {
  app: { name: 'हैगलर' },
  tabs: { home: 'सेवाएँ', settings: 'सेटिंग्स' },
  home: {
    title: 'आपको किस काम में मदद चाहिए?',
    subtitle: 'आपके पास सत्यापित रेंजर',
  },
  states: {
    loading: 'लोड हो रहा है…',
    error: 'लोड नहीं हो सका। अपना कनेक्शन जाँचें।',
    empty: 'यहाँ अभी कुछ नहीं है।',
    retry: 'फिर से कोशिश करें',
  },
  categories: {
    electrician: 'इलेक्ट्रीशियन',
    plumber: 'प्लंबर',
    cleaner: 'सफाई',
    carpenter: 'बढ़ई',
    appliance_repair: 'उपकरण मरम्मत',
    ac_repair: 'एसी मरम्मत',
    painter: 'पेंटर',
    pest_control: 'कीट नियंत्रण',
    gas_appliance_repair: 'गैस उपकरण मरम्मत',
  },
  settings: {
    title: 'सेटिंग्स',
    appearance: 'दिखावट',
    theme: { system: 'डिवाइस के अनुसार', light: 'हल्का', dark: 'गहरा' },
    language: 'भाषा',
    languageDevice: 'डिवाइस के अनुसार',
    environment: 'सर्वर की स्थिति',
    apiOk: 'जुड़ा हुआ है',
    apiDegraded: 'जुड़ा हुआ है (कुछ सेवाएँ धीमी हैं)',
    apiDown: 'सर्वर से संपर्क नहीं हो पा रहा',
    adapterSandbox: 'टेस्ट मोड',
    adapterLive: 'लाइव',
    adapters: {
      sms: 'एसएमएस',
      kyc: 'पहचान जाँच',
      payments: 'भुगतान',
      calls: 'सुरक्षित कॉल',
      push: 'सूचनाएँ',
      maps: 'नक्शे',
    },
  },
};
export default hi;
