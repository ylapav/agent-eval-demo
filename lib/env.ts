import { config } from "dotenv";

/**
 * Ympäristömuuttujat tsx-skripteille.
 *
 * Next lataa .env.local itse, mutta `npm run eval`, `npm run index` ja
 * migraatiot ovat paljaita Node-prosesseja. Ilman tätä ne näkisivät
 * tyhjän ympäristön ja kaatuisivat vasta ensimmäiseen API-kutsuun —
 * eli minuutteja myöhemmin ja väärällä virheilmoituksella.
 *
 * Järjestys on Nextin: .env.local voittaa .env:n. dotenv ei ylikirjoita
 * jo asetettuja muuttujia, joten oikea tiedosto ladataan ensin.
 */
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Ympäristömuuttuja ${name} puuttuu. Kopioi .env.example tiedostoksi .env.local ja täytä se.`,
    );
  }
  return v;
}
