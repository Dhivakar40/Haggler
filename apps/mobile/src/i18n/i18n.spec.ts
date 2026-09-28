import { SUPPORTED_LANGUAGES } from '@haggler/shared';
import i18n, { pickSupportedLanguage, resources } from './index';

function flatten(obj: object, prefix = ''): Record<string, string> {
  return Object.entries(obj).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'string' ? { ...acc, [key]: v } : { ...acc, ...flatten(v as object, key) };
  }, {});
}

const en = flatten(resources.en.translation);

describe('locales', () => {
  it('ships every launch language', () => {
    expect(Object.keys(resources).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  it.each(SUPPORTED_LANGUAGES)(
    '%s has exactly the same keys as English and no empty strings',
    (lang) => {
      const flat = flatten(resources[lang].translation);
      expect(Object.keys(flat).sort()).toEqual(Object.keys(en).sort());
      for (const [key, value] of Object.entries(flat)) {
        expect({ key, empty: value.trim() === '' }).toEqual({ key, empty: false });
      }
    },
  );

  it.each(SUPPORTED_LANGUAGES)('%s never calls a Ranger a "worker" in user-facing text', (lang) => {
    for (const value of Object.values(flatten(resources[lang].translation))) {
      expect(value.toLowerCase()).not.toMatch(/\bworkers?\b/);
    }
  });

  it('English uses the word Ranger', () => {
    expect(en['home.subtitle']).toContain('Rangers');
  });

  it('every category from the seed has a translation key in every language', () => {
    const seeded = [
      'electrician',
      'plumber',
      'cleaner',
      'carpenter',
      'appliance_repair',
      'ac_repair',
      'painter',
      'pest_control',
      'gas_appliance_repair',
    ];
    for (const lang of SUPPORTED_LANGUAGES) {
      const flat = flatten(resources[lang].translation);
      for (const slug of seeded) expect(flat[`categories.${slug}`]).toBeTruthy();
    }
  });
});

describe('language selection', () => {
  it('falls back to English for unsupported device languages', () => {
    expect(pickSupportedLanguage('fr')).toBe('en');
    expect(pickSupportedLanguage(null)).toBe('en');
    expect(pickSupportedLanguage('ta')).toBe('ta');
  });

  it('switches the active language at runtime', async () => {
    await i18n.changeLanguage('hi');
    expect(i18n.t('tabs.settings')).toBe('सेटिंग्स');
    await i18n.changeLanguage('en');
    expect(i18n.t('tabs.settings')).toBe('Settings');
  });
});
