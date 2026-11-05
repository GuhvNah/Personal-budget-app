/**
 * Sample CommBank "Transaction Summary" text, as produced by pdfToPages()
 * (pdf.js text grouped into lines). Layout copied from a real statement;
 * names, addresses and account numbers are made up.
 */
export const PAGE_1 = [
  'Account Number 062000 12345678',
  'Page 1 of 3',
  'JANE CITIZEN',
  '1 EXAMPLE ST',
  'PERTH WA Australia 6000',
  '05 November 2026',
  'Dear JANE CITIZEN,',
  'Here’s your account information and a list of transactions from 01/01/26-05/11/26.',
  'Account name JANE CITIZEN',
  'BSB 062000',
  'Account number 12345678',
  'Account type Everyday Offset',
  'Date opened 01/01/2024',
  'Date Transaction details Amount Balance',
  '02 Jan 2026 Direct Debit 123456 BUDGET DIRECT -$102.95 $5,113.92',
  '900000000000000001',
  '05 Jan 2026 Transfer to xx1111 CommBank app -$100.00 $5,013.92',
  '11 Jan 2026 Transfer to xx1111 CommBank app -$20.00 $4,993.92',
  'Value Date: 12/01/2026',
  '16 Feb 2026 Transfer from CommBank app $852.42 $5,846.34',
  '26 Mar 2026 Transfer to xx1111 CommBank app -$150.00 $5,696.34',
  '26 Mar 2026 Transfer to xx1111 CommBank app -$150.00 $5,546.34',
  'Created 05/11/26 09:03pm (Sydney/Melbourne time)',
  'While this letter is accurate at the time it’s produced,',
  'we’re not responsible for any reliance on this information. Transaction Summary v1.0.5',
];

export const PAGE_2 = [
  'Account Number 062000 12345678',
  'Page 2 of 3',
  'Date Transaction details Amount Balance',
  '18 May 2026 Transfer from xx2222 CommBank app $2,500.00 $8,046.34',
  'wage',
  '18 May 2026 Transfer to xx3333 CommBank app -$2,500.00 $5,546.34',
  'wage',
  '21 Sep 2026 Fast Transfer From STRIPE PAYMENTS CO $644.95 $6,191.29',
  'EXAMPLESHOP',
  'AB12CD34EF56',
  '02 Nov 2026 Direct Debit 123456 BUDGET DIRECT -$108.84 $6,082.45',
  '900000000000000002',
  'Created 05/11/26 09:03pm (Sydney/Melbourne time)',
  'While this letter is accurate at the time it’s produced,',
  'we’re not responsible for any reliance on this information. Transaction Summary v1.0.5',
];

export const PAGE_3 = [
  'Account Number 062000 12345678',
  'Page 3 of 3',
  'Any pending transactions haven’t been included in this list. Proceeds of cheques aren’t available until',
  'cleared.',
  'If you have questions or need more information, go to commbank.com.au/support.',
  'Kind regards,',
  'The CommBank Team.',
  'Created 05/11/26 09:03pm (Sydney/Melbourne time)',
  'we’re not responsible for any reliance on this information. Transaction Summary v1.0.5',
];

export const STATEMENT = [PAGE_1, PAGE_2, PAGE_3];
