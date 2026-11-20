/**
 * Canonical mapping between PCG telephony names (Runo/caller tags)
 * and the official portal / HR user names.
 */

export const PCG_RM_TELEPHONY_TO_CANONICAL: Record<string, string> = {
  // Samskrithi Rao
  'samskriti rao': 'Samskrithi Rao N',
  'samskriti': 'Samskrithi Rao N',
  'samskrithi rao': 'Samskrithi Rao N',
  'samskrithi rao n': 'Samskrithi Rao N',

  // Maniyar Kriya
  'kriya maniyar': 'Maniyar Kriya Jignesh',
  'maniyar kriya jignesh': 'Maniyar Kriya Jignesh',
  'kriya': 'Maniyar Kriya Jignesh',

  // Antara Chakraborty
  'antara chakrabarty': 'Antara Chakraborty',
  'antara chakraborty': 'Antara Chakraborty',
  'antara': 'Antara Chakraborty',

  // Vishal Kumar Yadav
  'vishal yadav': 'Vishal Kumar Yadav',
  'vishal kumar yadav': 'Vishal Kumar Yadav',

  // Shruti Sharma
  'shruti': 'Shruti Sharma',
  'shruti sharma': 'Shruti Sharma',

  // Nandini
  'nandani': 'Nandini',
  'nandini': 'Nandini',

  // Vaishnavi (distinct RMs on Team Swetha: Vaishnavi N J and Vaishnavi Naghat)
  'vaishnavi': 'Vaishnavi N J',
  'vaishnavi n j': 'Vaishnavi N J',
  'vaishnavi n. j.': 'Vaishnavi N J',
  'vaishnavi n.j.': 'Vaishnavi N J',
  'vaishnavi nj': 'Vaishnavi N J',
  'vaishnavi naghat': 'Vaishnavi Naghat',

  // Richa Mishra
  'richa mishra': 'Mishra Richa Santoshkumar',
  'richa': 'Mishra Richa Santoshkumar',
  'mishra richa santoshkumar': 'Mishra Richa Santoshkumar',

  // Shreya Mundada
  'shreya mundada': 'Shreya Premkumar Mundada',
  'shreya premkumar mundada': 'Shreya Premkumar Mundada',

  // Standard PCG RMs
  'ramita kapoor': 'Ramita Kapoor',
  'ramita': 'Ramita Kapoor',
  'shrey jain': 'Shrey Jain',
  'shrey': 'Shrey Jain',
  'ishaan kapoor': 'Ishaan Kapoor',
  'ishaan': 'Ishaan Kapoor',
  'yaashvi arora': 'Yaashvi Arora',
  'yaashvi': 'Yaashvi Arora',
  'paritosh ashiya': 'Paritosh Ashiya',
  'paritosh': 'Paritosh Ashiya',
  'sujal dadwani': 'Sujal Dadwani',
  'sujal': 'Sujal Dadwani',
  'diya sharma': 'Diya Sharma',
  'diya': 'Diya Sharma',
  'gaurav nautiyal': 'Gaurav Nautiyal',
  'gaurav': 'Gaurav Nautiyal',
  'sahil joshi': 'Sahil Joshi',
  'sahil': 'Sahil Joshi',
  'harshita dhona': 'Harshita Dhona',
  'harshita': 'Harshita Dhona',
  'deshna dugar': 'Deshna Dugar',
  'deshna': 'Deshna Dugar',
  'ankita agarwal': 'Ankita Agarwal',
  'ankita': 'Ankita Agarwal',
  'vidisha jaiswal': 'Vidisha Jaiswal',
  'vidisha': 'Vidisha Jaiswal',
  'nishtha veerwani': 'Nishtha Veerwani',
  'nishtha': 'Nishtha Veerwani',
  'suryansh sharma': 'Suryansh Sharma',
  'suryansh': 'Suryansh Sharma',
  'vishyata tulsani': 'Vishyata Tulsani',
  'vishyata': 'Vishyata Tulsani',
  'ayan kumar garg': 'Ayan Kumar Garg',
  'ayan': 'Ayan Kumar Garg',
  'mahi agarwal': 'Mahi Agarwal',
  'mahi': 'Mahi Agarwal',
  'rukmini mundhara': 'Rukmini Mundhara',
  'rukmini': 'Rukmini Mundhara',
  'keshvi suresh thacker': 'Keshvi Suresh Thacker',
  'keshvi': 'Keshvi Suresh Thacker',
  'nischay manish jain': 'Nischay Manish Jain',
  'nischay': 'Nischay Manish Jain',
  'sargun singh': 'Sargun Singh',
  'sargun': 'Sargun Singh',
  'shivam kumar baghel': 'Shivam Kumar Baghel',
  'shivam': 'Shivam Kumar Baghel',
  'sreeram': 'Sreeram',
  'sreeram v': 'Sreeram',

  // Associate Managers (AMs) on Team Swetha
  'aditi verma': 'Aditi Verma',
  'aditi': 'Aditi Verma',
  'arshnoor kaur': 'Arshnoor Kaur',
  'arshnoor': 'Arshnoor Kaur',
  'bhavnit singh': 'Bhavnit Singh',
  'bhavnit': 'Bhavnit Singh',

  // Team Leads
  'swetha': 'Swetha',
  'swetha jayakumar': 'Swetha',
  'tanisha': 'Tanisha Mittal',
  'tanisha mittal': 'Tanisha Mittal',
  'saiyam': 'Saiyam Rastogi',
  'saiyam rastogi': 'Saiyam Rastogi',
  'dheeraj': 'Dheeraj Bhojwani',
  'dheeraj bhojwani': 'Dheeraj Bhojwani',
  'sravanthi': 'Sravanthi',
};

export const ALL_TL_NAMES = [
  'Swetha',
  'Swetha Jayakumar',
  'Saiyam Rastogi',
  'Tanisha Mittal',
  'Dheeraj Bhojwani',
  'Sravanthi',
];

export function isPcgTl(name?: string | null): boolean {
  if (!name) return false;
  const canonical = canonicalizePcgRmName(name).toLowerCase().trim();
  const raw = name.toLowerCase().trim();
  return ALL_TL_NAMES.some((tl) => {
    const tLower = tl.toLowerCase();
    return canonical === tLower || raw === tLower || raw.includes(tLower) || canonical.includes(tLower);
  });
}

export const PCG_AM_NAMES = new Set([
  'ankita agarwal',
  'vishyata tulsani',
  'aditi verma',
  'arshnoor kaur',
  'bhavnit singh',
]);

export function isPcgAm(name?: string | null): boolean {
  if (!name) return false;
  const canonical = canonicalizePcgRmName(name).toLowerCase().trim();
  const raw = name.toLowerCase().trim();
  return PCG_AM_NAMES.has(canonical) || PCG_AM_NAMES.has(raw);
}

/**
 * First names that are ambiguous because multiple distinct RMs share the same first name.
 * A bare first name or first-name prefix must never be used to equate two different agents for these.
 */
const AMBIGUOUS_PCG_FIRST_NAMES = new Set(['vaishnavi']);

/**
 * Normalizes any variation of an RM name to its canonical display name.
 */
export function canonicalizePcgRmName(name?: string | null): string {
  if (!name || !name.trim()) return 'Unknown RM';
  const clean = name.trim().toLowerCase();
  if (PCG_RM_TELEPHONY_TO_CANONICAL[clean]) {
    return PCG_RM_TELEPHONY_TO_CANONICAL[clean];
  }
  // Try normalized punctuation (e.g. "Vaishnavi N. J." -> "vaishnavi n j")
  const normalized = clean.replace(/[\.\,\-_]/g, ' ').replace(/\s+/g, ' ').trim();
  if (PCG_RM_TELEPHONY_TO_CANONICAL[normalized]) {
    return PCG_RM_TELEPHONY_TO_CANONICAL[normalized];
  }
  return name.trim();
}

/**
 * Checks whether two RM name representations refer to the same agent.
 */
export function isSamePcgAgent(nameA?: string | null, nameB?: string | null): boolean {
  if (!nameA || !nameB) return false;

  const canA = canonicalizePcgRmName(nameA).toLowerCase();
  const canB = canonicalizePcgRmName(nameB).toLowerCase();
  if (canA === canB) return true;

  const rawA = nameA.trim().toLowerCase();
  const rawB = nameB.trim().toLowerCase();
  if (rawA === rawB) return true;

  const normA = rawA.replace(/[\.\,\-_]/g, ' ').replace(/\s+/g, ' ').trim();
  const normB = rawB.replace(/[\.\,\-_]/g, ' ').replace(/\s+/g, ' ').trim();
  if (normA === normB) return true;

  const tokensA = normA.split(/\s+/).filter(Boolean);
  const tokensB = normB.split(/\s+/).filter(Boolean);

  // If both names are multi-word (e.g., "Vaishnavi N J" vs "Vaishnavi Naghat", or "Shruti Sharma" vs "Diya Sharma"),
  // they are distinct individuals and must NEVER match just because they share a first name!
  if (tokensA.length > 1 && tokensB.length > 1) {
    return false;
  }

  // If one of the names is a single word (e.g., telephony tag "Sujal" matching "Sujal Dadwani")
  const firstA = tokensA[0];
  const firstB = tokensB[0];
  if (firstA && firstB && firstA === firstB && firstA.length > 3) {
    // If the shared first name is ambiguous (like "Vaishnavi" where both "Vaishnavi N J"
    // and "Vaishnavi Naghat" are active RMs), do NOT match!
    if (AMBIGUOUS_PCG_FIRST_NAMES.has(firstA)) {
      return false;
    }
    return true;
  }

  return false;
}
