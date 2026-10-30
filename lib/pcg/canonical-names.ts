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

  // Vaishnavi
  'vaishnavi': 'Vaishnavi N J',
  'vaishnavi n j': 'Vaishnavi N J',
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
  'shrey jain': 'Shrey Jain',
  'ishaan kapoor': 'Ishaan Kapoor',
  'yaashvi arora': 'Yaashvi Arora',
  'paritosh ashiya': 'Paritosh Ashiya',
  'sujal dadwani': 'Sujal Dadwani',
  'diya sharma': 'Diya Sharma',
  'gaurav nautiyal': 'Gaurav Nautiyal',
  'sahil joshi': 'Sahil Joshi',
  'harshita dhona': 'Harshita Dhona',
  'deshna dugar': 'Deshna Dugar',
  'ankita agarwal': 'Ankita Agarwal',
  'vidisha jaiswal': 'Vidisha Jaiswal',
  'nishtha veerwani': 'Nishtha Veerwani',
  'suryansh sharma': 'Suryansh Sharma',
  'vishyata tulsani': 'Vishyata Tulsani',
};

/**
 * Normalizes any variation of an RM name to its canonical display name.
 */
export function canonicalizePcgRmName(name?: string | null): string {
  if (!name || !name.trim()) return 'Unknown RM';
  const clean = name.trim().toLowerCase();
  return PCG_RM_TELEPHONY_TO_CANONICAL[clean] || name.trim();
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

  // First name fallback if unambiguous
  const firstA = rawA.split(' ')[0];
  const firstB = rawB.split(' ')[0];
  if (firstA && firstB && firstA === firstB && firstA.length > 3) {
    // Avoid ambiguous short first names like 'team', 'test', etc.
    return true;
  }

  return false;
}
