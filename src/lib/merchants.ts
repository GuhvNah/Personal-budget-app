import type { BuiltinCategory } from './types';

/**
 * Built-in list of common Australian merchants and keywords. Matched against
 * the upper-cased description on word boundaries (so "BP" doesn't match
 * "BPAY"). `strong` matches are applied automatically; weak ones are only
 * suggested. Longer patterns win over shorter ones.
 */
export interface MerchantEntry {
  keywords: string[];
  category: BuiltinCategory;
  strong: boolean;
  /** Only match money in (credits) or money out (debits). */
  direction?: 'in' | 'out';
}

export const MERCHANTS: MerchantEntry[] = [
  {
    category: 'groceries',
    strong: true,
    keywords: ['WOOLWORTHS', 'WOOLIES', 'COLES', 'ALDI', 'IGA', 'FOODWORKS', 'HARRIS FARM', 'SPUDSHED', 'SPUD SHED', 'COSTCO', 'DRAKES', 'FOODLAND', 'NUTS ABOUT', 'FARMER JACKS', 'CHARLIE CARTERS'],
  },
  { category: 'groceries', strong: false, keywords: ['SUPERMARKET', 'BUTCHER', 'BAKERY', 'GREENGROCER', 'FRUIT', 'MARKET'] },
  {
    category: 'fuel',
    strong: true,
    keywords: ['COLES EXPRESS', 'BP', 'AMPOL', 'CALTEX', 'SHELL', '7-ELEVEN', '7 ELEVEN', 'PUMA', 'UNITED PETROLEUM', 'LIBERTY OIL', 'VIBE PETROLEUM', 'METRO PETROLEUM', 'EG FUEL', 'OTR', 'ENERGY AUSTRALIA FUEL'],
  },
  { category: 'fuel', strong: false, keywords: ['PETROL', 'FUEL', 'SERVO'] },
  {
    category: 'eating-out',
    strong: true,
    keywords: ['MCDONALDS', "MCDONALD'S", 'KFC', 'HUNGRY JACKS', "HUNGRY JACK'S", 'DOMINOS', "DOMINO'S", 'PIZZA HUT', 'SUBWAY', 'GUZMAN Y GOMEZ', 'GYG', 'NANDOS', "NANDO'S", 'OPORTO', 'RED ROOSTER', 'CHICKEN TREAT', 'GRILLD', "GRILL'D", 'SUSHI', 'UBER EATS', 'UBER *EATS', 'MENULOG', 'DOORDASH', 'STARBUCKS', 'GLORIA JEANS', 'ZARRAFFAS', 'BOOST JUICE', 'MUZZ BUZZ', 'JESTERS', 'HOGS BREATH', 'SIZZLER'],
  },
  { category: 'eating-out', strong: false, keywords: ['CAFE', 'COFFEE', 'RESTAURANT', 'PIZZA', 'BURGER', 'KEBAB', 'TAKEAWAY', 'BAR', 'PUB', 'TAVERN', 'HOTEL', 'BREWING', 'THAI', 'NOODLE'] },
  {
    category: 'entertainment',
    strong: true,
    keywords: ['NETFLIX', 'SPOTIFY', 'DISNEY PLUS', 'DISNEY+', 'STAN.COM', 'STAN ', 'BINGE', 'KAYO', 'FOXTEL', 'YOUTUBE PREMIUM', 'APPLE.COM/BILL', 'GOOGLE PLAY', 'PLAYSTATION', 'XBOX', 'STEAM', 'STEAMGAMES', 'NINTENDO', 'HOYTS', 'EVENT CINEMAS', 'READING CINEMAS', 'GRAND CINEMAS', 'TICKETEK', 'TICKETMASTER', 'TIMEZONE', 'AUDIBLE', 'PARAMOUNT+'],
  },
  { category: 'entertainment', strong: false, keywords: ['CINEMA', 'MOVIES', 'TICKETS', 'BOWLING', 'GAMES'] },
  {
    category: 'bills',
    strong: true,
    keywords: ['SYNERGY', 'ALINTA', 'WATER CORP', 'WATER CORPORATION', 'HORIZON POWER', 'AGL', 'ORIGIN ENERGY', 'ENERGYAUSTRALIA', 'RED ENERGY', 'TELSTRA', 'OPTUS', 'VODAFONE', 'TPG', 'IINET', 'AUSSIE BROADBAND', 'BELONG', 'AMAYSIM', 'BOOST MOBILE', 'DODO', 'COUNCIL', 'CITY OF', 'SHIRE OF', 'DEPT OF TRANSPORT', 'DOT LICENSING', 'TRANSPERTH', 'SMARTRIDER'],
  },
  { category: 'bills', strong: false, keywords: ['ENERGY', 'ELECTRICITY', 'GAS', 'INTERNET', 'MOBILE', 'PHONE', 'RATES', 'REGO', 'LICENCE'] },
  {
    category: 'insurance',
    strong: true,
    keywords: ['BUDGET DIRECT', 'BUPA', 'MEDIBANK', 'HCF', 'NIB', 'HBF', 'AHM', 'RAC INSURANCE', 'RACWA', 'RAC WA', 'AAMI', 'ALLIANZ', 'SUNCORP', 'NRMA', 'YOUI', 'BINGLE', 'GIO', 'QBE', 'TAL LIFE', 'AIA'],
  },
  { category: 'insurance', strong: false, keywords: ['INSURANCE', 'INSURE', 'PREMIUM'] },
  {
    category: 'childcare',
    strong: true,
    keywords: ['GOODSTART', 'CHILDCARE', 'CHILD CARE', 'EARLY LEARNING', 'OSHC', 'KINDY', 'KINDERGARTEN', 'DAYCARE', 'DAY CARE', 'GUARDIAN CHILDCARE', 'NIDO'],
  },
  { category: 'rent', strong: true, keywords: ['HOME LOAN', 'LOAN REPAYMENT', 'MORTGAGE'], direction: 'out' },
  { category: 'rent', strong: false, keywords: ['RENT', 'REAL ESTATE', 'PROPERTY MANAGEMENT', 'STRATA'], direction: 'out' },
  { category: 'income', strong: true, keywords: ['SALARY', 'PAYROLL', 'WAGES', 'WAGE', 'PAY ', 'CENTRELINK', 'SERVICES AUSTRALIA', 'ATO', 'TAX REFUND'], direction: 'in' },
  { category: 'income', strong: false, keywords: ['INTEREST', 'DIVIDEND', 'REFUND'], direction: 'in' },
];

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Pre-compiled matchers, longest keyword first. */
const COMPILED = MERCHANTS.flatMap((e) =>
  e.keywords.map((k) => ({
    keyword: k.trim(),
    entry: e,
    // Word boundaries on whichever ends of the keyword are word characters.
    re: new RegExp(`${/^\w/.test(k) ? '\\b' : ''}${escape(k.trim())}${/\w$/.test(k.trim()) ? '\\b' : ''}`),
  })),
).sort((a, b) => b.keyword.length - a.keyword.length);

export interface MerchantMatch {
  keyword: string;
  category: BuiltinCategory;
  strong: boolean;
}

/** Best built-in match for a description, or null. Strong matches beat weak ones. */
export function matchMerchant(description: string, amount: number): MerchantMatch | null {
  const text = ` ${description.toUpperCase().replace(/\s+/g, ' ')} `;
  const direction = amount > 0 ? 'in' : 'out';
  let weak: MerchantMatch | null = null;
  for (const c of COMPILED) {
    if (c.entry.direction && c.entry.direction !== direction) continue;
    if (!c.re.test(text)) continue;
    const m = { keyword: c.keyword, category: c.entry.category, strong: c.entry.strong };
    if (m.strong) return m;
    weak ??= m;
  }
  return weak;
}
