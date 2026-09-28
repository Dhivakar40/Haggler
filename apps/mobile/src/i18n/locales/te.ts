import type { Translation } from './en';

// Draft translation. Needs review by a native speaker before launch (docs/COMPLIANCE.md).
const te: Translation = {
  app: { name: 'హ్యాగ్లర్' },
  tabs: { home: 'సేవలు', settings: 'సెట్టింగ్‌లు' },
  home: {
    title: 'మీకు ఏ సహాయం కావాలి?',
    subtitle: 'మీ దగ్గరలోని ధృవీకరించబడిన రేంజర్లు',
  },
  states: {
    loading: 'లోడ్ అవుతోంది…',
    error: 'లోడ్ చేయలేకపోయాం. మీ కనెక్షన్‌ను తనిఖీ చేయండి.',
    empty: 'ఇక్కడ ఇంకా ఏమీ లేదు.',
    retry: 'మళ్ళీ ప్రయత్నించండి',
  },
  categories: {
    electrician: 'ఎలక్ట్రీషియన్',
    plumber: 'ప్లంబర్',
    cleaner: 'క్లీనింగ్',
    carpenter: 'వడ్రంగి',
    appliance_repair: 'గృహోపకరణాల మరమ్మతు',
    ac_repair: 'ఏసీ మరమ్మతు',
    painter: 'పెయింటర్',
    pest_control: 'పెస్ట్ కంట్రోల్',
    gas_appliance_repair: 'గ్యాస్ ఉపకరణ మరమ్మతు',
  },
  settings: {
    title: 'సెట్టింగ్‌లు',
    appearance: 'రూపం',
    theme: { system: 'పరికరం ప్రకారం', light: 'వెలుగు', dark: 'చీకటి' },
    language: 'భాష',
    languageDevice: 'పరికరం ప్రకారం',
    environment: 'సర్వర్ స్థితి',
    apiOk: 'కనెక్ట్ అయింది',
    apiDegraded: 'కనెక్ట్ అయింది (కొన్ని సేవలు నెమ్మదిగా ఉన్నాయి)',
    apiDown: 'సర్వర్‌ను చేరుకోలేకపోతున్నాం',
    adapterSandbox: 'టెస్ట్ మోడ్',
    adapterLive: 'లైవ్',
    adapters: {
      sms: 'ఎస్ఎంఎస్',
      kyc: 'గుర్తింపు తనిఖీ',
      payments: 'చెల్లింపులు',
      calls: 'సురక్షిత కాల్స్',
      push: 'నోటిఫికేషన్లు',
      maps: 'మ్యాప్స్',
    },
  },
};
export default te;
