/**
 * Builder stock — the page text of the builder's OWN package covers, verbatim.
 *
 * Every string here was extracted from a document in the live "Complete Package
 * Pack" Drive libraries the stock rows link to. They are fixtures rather than
 * paraphrases because the defect they pin is entirely about WORDING: the rule
 * they exercise refused twenty-five live properties for the difference between
 * "Tweed Heads South NSW 2486" in the stock list and "Tweed Heads NSW" on the
 * builder's own cover for the same house.
 *
 * Two things in here look like mistakes and are not. The letter-spaced heading
 * — "L O T 5 1 · S A N D P I P E R  E S T A T E" — is what PDF extraction
 * returns for tracked type, and it is why a matcher cannot rely on the heading
 * alone. And `covella_lot914` is the EMPTY STRING: that document is three pages
 * of designed brochure exported as images, and its every page yields no text at
 * all. It is here so a reader that learns nothing is never mistaken for a
 * document that says nothing.
 */

/** Page 1 of "Lot 51 - Miami 190 - Property Package.pdf". */
export const LOT_51_MIAMI_190_PAGE_1 = "PROPLAUNCH\nL O T 5 1 · S A N D P I P E R E S T A T E\nFour bedroom home, 190 m².\nFixed price. Fully turnkey.\nLot 51, Sandpiper Estate, Tweed Heads NSW · Miami 190, Spectral façade · 623 m² lot,\nregistering Q1 2027 · Four bedrooms, two bathrooms, study nook, walk-in pantry, under-\nroof alfresco and a double garage. Full turnkey specification listed in the accompanying\nSandpiper Estate Inclusions — Single Dwelling document.\nT O T A L P A C K A G E · L A N D + B U I L D · I N C . G S T\n$1,386,407\nLand $839,000\nBuild $547,407\nRental appraisal $1,250–$1,300 /wk\nFixed price site costs included\nL A N D\n623 m²\nT O T A L H O M E\n190 m²\nB E D / B A T H\n4 / 2\nG A R A G E\n2\nE S T A T E · L O C A T I O N\nSandpiper Estate · Tweed Heads\nNSW\nR E G I S T R A T I O N\nQ1 2027\nD E S I G N · F A Ç A D E\nMiami 190 · Spectral\nA R T I S T I M P R E S S I O N O N L Y\n0 1 / 0 7\nF I X E D P R I C E , F I X E D S I T E C O S T S\n";

/** Page 1 of "Lot 51 - Miami 196 - Property Package.pdf" — same lot, next design. */
export const LOT_51_MIAMI_196_PAGE_1 = "PROPLAUNCH\nL O T 5 1 · S A N D P I P E R E S T A T E\nFour bedroom home, 197 m².\nFixed price. Fully turnkey.\nLot 51, Sandpiper Estate, Tweed Heads NSW · Miami 196, Spectral façade · 623 m² lot,\nregistering Q1 2027 · Four bedrooms plus a separate lounge and study, two bathrooms,\nwalk-in pantry, under-roof alfresco and a double garage. Full turnkey specification listed in\nthe accompanying Sandpiper Estate Inclusions — Single Dwelling document.\nT O T A L P A C K A G E · L A N D + B U I L D · I N C . G S T\n$1,401,306\nLand $839,000\nBuild $562,306\nRental appraisal $1,300–$1,350 /wk\nFixed price site costs included\nL A N D\n623 m²\nT O T A L H O M E\n197 m²\nB E D / B A T H\n4 / 2\nG A R A G E\n2\nE S T A T E · L O C A T I O N\nSandpiper Estate · Tweed Heads\nNSW\nR E G I S T R A T I O N\nQ1 2027\nD E S I G N · F A Ç A D E\nMiami 196 · Spectral\nA R T I S T I M P R E S S I O N O N L Y\n0 1 / 0 7\nF I X E D P R I C E , F I X E D S I T E C O S T S\n";

/** Page 1 of "Lot 52 - Miami 190 - Property Package.pdf" — same design, next lot. */
export const LOT_52_MIAMI_190_PAGE_1 = "PROPLAUNCH\nL O T 5 2 · S A N D P I P E R E S T A T E\nFour bedroom home, 190 m².\nFixed price. Fully turnkey.\nLot 52, Sandpiper Estate, Tweed Heads NSW · Miami 190, Spectral façade · 623 m² lot,\nregistering Q1 2027 · Four bedrooms, two bathrooms, study nook, walk-in pantry, under-\nroof alfresco and a double garage. Full turnkey specification listed in the accompanying\nSandpiper Estate Inclusions — Single Dwelling document.\nT O T A L P A C K A G E · L A N D + B U I L D · I N C . G S T\n$1,386,407\nLand $839,000\nBuild $547,407\nRental appraisal $1,250–$1,300 /wk\nFixed price site costs included\nL A N D\n623 m²\nT O T A L H O M E\n190 m²\nB E D / B A T H\n4 / 2\nG A R A G E\n2\nE S T A T E · L O C A T I O N\nSandpiper Estate · Tweed Heads\nNSW\nR E G I S T R A T I O N\nQ1 2027\nD E S I G N · F A Ç A D E\nMiami 190 · Spectral\nA R T I S T I M P R E S S I O N O N L Y\n0 1 / 0 7\nF I X E D P R I C E , F I X E D S I T E C O S T S\n";

/** Page 1 of "LOT 914 • COVELLA • GREENBANK QLD.pdf". Drawn, not set. */
export const COVELLA_LOT_914_PAGE_1 = "";

/** The stock list's own wording for those rows, verbatim from `address_line`. */
export const SANDPIPER_ADDRESS =
  'Tringa Street, Sandpiper Estate, Tweed Heads South NSW 2486';
export const COVELLA_ADDRESS = 'Lot 914 - Covella Estate, Greenbank QLD 4124';
