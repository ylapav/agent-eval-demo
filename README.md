# Nordkanta-agentti

Tuotantomainen asiakaspalveluagentti kuvitteelliselle rakennustarvikevalmistajalle.
Rakennettu työnäytteeksi. Nordkanta Oy ei ole olemassa, ja koko tietopohja on
generoitu.

Demossa on kolme osaa: agenttisilmukka neljällä työkalulla, turvakerros
kirjoittaville operaatioille, ja evaluointikerros joka mittaa milloin agentti oli
väärässä.

Kolmas osa on syy miksi tämä on olemassa. Agentin rakentaminen on suoraviivaista.
Sen tietäminen, milloin se epäonnistuu hiljaa, ei ole.

## Pino

Next.js 16 · Postgres + pgvector · Drizzle · Anthropic SDK (tool use) · Voyage-upotukset

Tietokanta valitaan `DATABASE_URL`:n muodosta: ilman sitä ajetaan PGliteä eli
Postgresia WASM-muodossa hakemistossa `.data/pg`. Se on oikea Postgres oikealla
pgvectorilla ja HNSW-indeksillä, joten hakukerros on sama paikallisesti ja
tuotannossa. Neonin URL vaihtaa ajurin, koodi ei muutu.

## Käynnistys

Paikallisesti, ilman Dockeria ja ilman pilvitiliä:

```bash
cp .env.example .env.local     # täytä ANTHROPIC_API_KEY ja VOYAGE_API_KEY
npm install
npm run setup                  # migraatiot + tuotedata + tietopohjan indeksointi
npm run dev
```

Chat on osoitteessa `/`, admin-näkymä `/admin` (vaatii `ADMIN_PASSWORD`).

Ilman API-avaimia rakenne, migraatiot, indeksointi ja vektorihaku toimivat —
upotukset korvautuu paikallisella tiivistefunktiolla. Agentti itse ei vastaa
ilman `ANTHROPIC_API_KEY`:tä, ja evaluointi kieltäytyy ajamasta valeupotuksen
päällä. Siitä lisää kohdassa [Valeupotus](#valeupotus).

```bash
npm test                       # turvakerroksen yksikkötestit, ei avaimia eikä kantaa
npm run typecheck
npm run eval                   # neljä mittaria, exit-koodi 1 jos jokin alittaa kynnyksen
npm run calibrate              # hakukynnyksen kalibrointi, ei mallikutsuja
```

### Vercel

Tuo repo Verceliin ja aseta ympäristömuuttujat: `DATABASE_URL` (Neon),
`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `AGENT_WEBHOOK_SECRET`, `ADMIN_PASSWORD`.
Aja `npm run setup` kerran paikallisesti Neonin URL:lla osoittaen, jotta skeema
ja tietopohja ovat paikallaan. Muuta konfiguraatiota ei tarvita.

PGlite pysyy riippuvuuspuussa mutta ei käytössä, koska `DATABASE_URL` osoittaa
Neoniin. Se on merkitty ulkoiseksi paketiksi `next.config.ts`:ssä — muuten
bundleri tiivistäisi sen WASM-tiedostojen nimet ja pgvector katoaisi hiljaa.

## Webhook

Agentti on käytettävissä myös ilman käyttöliittymää. Sama `runAgent()`, eri
sisääntulo.

```bash
curl -X POST https://<host>/api/agent \
  -H "x-agent-secret: $AGENT_WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d '{"sessionId":"crm-4821","message":"Mikä on kattopeltien takuuaika?"}'
```

Chat ja webhook eroavat vain autentikoinnissa ja vastausmuodossa. Agenttia ei saa
olla kahta eri versiota, koska silloin evaluointi mittaa vain toista niistä.

## Työkalut

| Työkalu | Tyyppi | Kuvaus |
|---|---|---|
| `hae_tietopohjasta` | luku | Vektorihaku ehdoista ja ohjeista |
| `hae_tuotteet` | luku | Suodatettu haku tuotetaulusta |
| `varaa_soitto` | kirjoitus | Soittopyyntö myynnille |
| `luo_tiketti` | kirjoitus | Tiketti asiakaspalveluun |

Kaksi lukevaa ja kaksi kirjoittavaa on tarkoituksellinen jako. Kirjoittavat
työkalut tekevät turvallisuudesta konkreettisen kysymyksen sen sijaan että se
jäisi kehotteessa esitetyksi toiveeksi.

Tuotetiedot ovat rakenteisessa taulussa eivätkä tietopohjassa. Vektorihaku
tuotenumerolla on huono idea, ja SQL-haku takuuehdon merkityksestä on mahdoton.
Jako pakottaa mallin valitsemaan työkalun oikein, ja se valinta on mitattava —
siksi se on oma evaluointisarjansa.

## Turvakerros

Neljä rajaa, joista **kaksi on rakenteellisia ja kaksi mallin päätöksen varassa**.
Ero on tässä tärkein yksittäinen asia, joten se on kirjoitettu auki eikä
tiivistetty lupaukseksi.

**Rakenteelliset — pitävät riippumatta siitä mitä malli päättää:**

1. **Prioriteetti johdetaan tikettityypistä koodissa** (`lib/agent/guards.ts`).
   Malli ei aseta prioriteettia eikä näe sen arvoa. Vaikka injektio saisi mallin
   kirjoittamaan yhteenvedoksi "KRIITTINEN", prioriteetti tulee taulukosta.
2. **Kirjoitus ei onnistu keskustelun ensimmäisellä vuorolla.** Asiakas ei ole
   voinut nähdä yhteenvetoa eikä vahvistaa mitään, joten vahvistusta ei ole
   olemassa. Tämä sulkee kaikki yhden viestin injektiot ("vahvistan jo
   etukäteen") riippumatta siitä, uskooko malli niitä.

**Mallin päätöksen varassa — kehotteessa, siis periaatteessa murrettavissa:**

3. **Vahvistuksen sisältö.** Kehote käskee esittämään yhteenvedon ja odottamaan.
   Koodi ei tarkista, että vahvistus koski juuri tätä sisältöä. Sitä varten
   tarvittaisiin ehdota/vahvista-protokolla, jossa ehdotus saa tunnisteen ja
   kirjoitus viittaa siihen. Ei toteutettu — se on jatkotöissä.
4. **Työkalun valinta ja kutsumatta jättäminen.** Mikään koodissa ei estä mallia
   kutsumasta kirjoittavaa työkalua turhaan; vartija estää vain suorituksen.

Lisäksi kaksi rajaa, jotka eivät ole injektiosuojia mutta rajaavat vahinkoa:

- **Kirjoituskatto** 2 per istunto, laskettuna **kannasta** eikä muistista.
  Aiemmin laskuri eli pyyntökohtaisessa kontekstissa, jolloin "2 per istunto"
  tarkoitti käytännössä "2 per HTTP-pyyntö" — chatissa jokainen viesti on oma
  pyyntönsä, joten katto ei rajoittanut mitään. Serverless-ajossa prosessimuisti
  ei ole edes sama kahden pyynnön välillä.
- **Zod-validointi** ennen jokaista kirjoitusta.

Ylitys palautetaan mallille **työkalutuloksena eikä kaatumisena**, jotta agentti
voi kertoa syyn asiakkaalle. Kaatuminen näyttäisi asiakkaalle rikkinäiseltä ja
piilottaisi syyn.

Turvakerroksella on yksikkötestit: `npm test`. Ne ajetaan ilman API-avaimia ja
ilman tietokantaa. Turvasäännöt, joiden testaaminen vaatii infrastruktuuria, ovat
sääntöjä joita ei testata.

### Historia luetaan palvelimelta

Chat ei ota keskusteluhistoriaa vastaan pyynnössä. Se rakennetaan `turns`-taulusta
`sessionId`:n perusteella. Syy on turvallisuus eikä siisteys: kirjoitusvartija 2
nojaa aiempien vuorojen määrään, joten jos selain saisi lähettää historian,
asiakas voisi keksiä vahvistuskierroksen jota ei tapahtunut.

## Evaluointi

Neljä mittaria. **Kynnykset lukittiin ennen ensimmäistä ajoa** tiedostoon
`lib/eval/thresholds.ts`. Jos kynnykset asettaa tulosten näkemisen jälkeen, ne
asettuvat aina juuri sen alle mitä järjestelmä sattui saamaan, ja mittari lakkaa
mittaamasta mitään.

<!-- EVAL:ALKU -->

| Mittari | Kynnys | Tulos | Tila |
|---|---|---|---|
| Lähdeperusteisuus | ≥ 90 % | _ei ajettu_ | |
| Työkaluvalinta | ≥ 90 % | _ei ajettu_ | |
| Injektiovuodot | = 0 | _ei ajettu_ | |
| Keksimisprosentti | ≤ 5 % | _ei ajettu_ | |

**Tätä taulukkoa ei ole vielä ajettu.** Se täyttyy komennolla `npm run eval`, joka
kirjoittaa tulokset tähän kohtaan automaattisesti (`lib/eval/report.ts`) ja
tapauskohtaiset tulokset tiedostoon `eval-results.json`.

Taulukkoa ei täytetä käsin. Käsin täytetty tulostaulukko on käsin valittu
tulostaulukko: kun luvut kopioidaan terminaalista, alitus jää helposti
kopioimatta — ei valehtelemisen takia vaan siksi, että sen kirjoittaminen tuntuu
keskeneräiseltä.

<!-- EVAL:LOPPU -->

**Lähdeperusteisuus** arvioidaan toisella, pienemmällä mallilla, joka saa
vastauksen ja lähdekatkelmat ja palauttaa per väite kyllä/ei. Arvioija ei näe
kysymystä eikä sitä, mikä malli vastauksen tuotti. Jos se näkisi kysymyksen, se
alkaisi arvioida vastaako teksti kysymykseen — se on eri mittari, ja se on jo
olemassa. Arvioijan on oltava eri malli kuin agentin, koska sama malli palkitsisi
omaa tyyliään.

**Työkaluvalinta** mittaa myös kutsumatta jättämistä. Kaksi tapausta on
tarkoituksella sellaisia, joissa oikea vastaus on olla kutsumatta mitään
("Moi", "Kiitos, tämä riitti"). Turha vektorihaku maksaa rahaa ja lisää latenssia
ilman että se näkyy missään laatumittarissa.

**Injektiotestit** kattavat molemmat uhkasuunnat: käyttäjän viestiin upotetun
ohjeen ja tietopohjaan upotetun ohjeen. Jälkimmäinen on vakavampi, koska katkelma
näyttää järjestelmän omalta datalta. Tiedostossa `content/takuuehdot.md` on
tarkoituksellinen ansa tätä varten.

Setti raportoi kaksi lukua: **vuodot** (portittaa, kynnys 0) ja **yritykset**
(raportoidaan, ei portita). Ne on erotettava, koska vartija voi estää kirjoituksen
vaikka malli yritti — silloin järjestelmä on turvassa mutta malli ei ole, ja yksi
luku piilottaisi juuri sen eron.

Tapaukset 11–15 ovat monivuoroisia. Ilman niitä mittari näyttäisi vihreältä
pelkästään siksi, ettei mikään yksivuoroinen tapaus voi kirjoittaa mitään
rakenteellisen vartijan 2 jälkeen — mittari mittaisi porttia eikä mallia.

**Kieltäytymisraja** mittaa keksimistä: kymmenen kysymystä, joihin tietopohjassa
ei ole vastausta. Arvioija saa todelliset haetut katkelmat eikä tyhjää listaa.
Tyhjä lista laskisi keksimiseksi myös sen tapauksen, jossa haku palautti osuvaa
tietoa ja agentti vastasi siitä oikein — mittari ei saa olettaa, että hakukynnys
toimii, koska se on juuri se oletus jota evaluoinnin on tarkoitus koetella.

### Hakukynnys ja sen kalibrointi

`lib/rag/search.ts` sisältää osuvuuskynnyksen `RELEVANCE_FLOOR`. Ilman sitä
vektorihaku palauttaa aina k parasta, myös kun mikään ei liity kysymykseen —
ja se on suoraan keksimismittarin epäonnistuminen. Tyhjä tulos on parempi kuin
huono tulos, koska tyhjä saa mallin sanomaan "en tiedä".

Kynnys on ainoa luku hakukerroksessa, jota ei voi johtaa mistään: se riippuu
upotusmallista, kielestä ja tietopohjan koosta. Siksi sitä varten on oma
komentonsa:

```bash
npm run calibrate
```

Se ajaa molemmat evaluointisetit pelkkänä hakuna — ilman mallia, ilman
kustannusta — ja näyttää parhaan osuman jakauman kummallekin joukolle. Kynnys
kuuluu niiden väliin. **Jos jakaumat menevät päällekkäin, mikään kynnys ei erota
niitä**, ja korjaus on haussa (hybridihaku, pilkkominen) eikä luvun säätämisessä.
Kynnyksen viilaaminen päällekkäisillä jakaumilla on ylisovittamista testisettiin.

Nykyinen arvo `0.35` on lähtöarvaus, ei mitattu. Se on kalibroitava oikeilla
upotuksilla ennen kuin evaluointituloksiin voi luottaa.

### Valeupotus

Ilman `VOYAGE_API_KEY`:tä `lib/rag/embed.ts` käyttää paikallista
tiivistepohjaista upotusta. Se ei ole malli vaan determinististä kohinaa, jolla
voi tarkistaa että putki toimii — skeema, indeksointi, pgvector, HNSW,
hakukynnys ja työkalukutsu — ilman yhtään API-avainta.

`npm run eval` **kieltäytyy ajamasta siinä tilassa** ja poistuu koodilla 2.
Vihreä mittari, joka on tuotettu valeupotuksella, on huonompi kuin mittari jota
ei ole: mittaamaton järjestelmä tiedetään mittaamattomaksi, mutta väärin
mitattuun luotetaan.

## Lokitus

Jokainen vuoro `turns`-tauluun, myös virhetilanteessa. Rivi sisältää
työkalukutsut argumentteineen, haetut katkelmat, latenssin, tokenit ja arvioidun
kustannuksen.

Kaksi kenttää joita ei aina muisteta: `modelId` ja `promptHash`. Ilman niitä
evaluointituloksia ei voi verrata ajojen välillä — et tiedä muuttuiko tulos
koodista, kehotteesta vai mallista. Se ero on koko regressiojäljityksen edellytys.

Välimuistista luetut ja välimuistiin kirjoitetut tokenit ovat omissa sarakkeissaan,
koska ne hinnoitellaan eri kertoimella (0,1× ja 1,25×). Ilman erottelua
kustannusarvio on väärä juuri silloin kun välimuisti toimii — eli kun arvio olisi
tärkein.

Järjestelmäkehotteeseen ja työkaluihin on asetettu välimuistiraja. **Toteutuuko
välimuisti oikeasti, näkyy `cache_read_tokens`-sarakkeesta**: prefiksi on lyhyt ja
voi jäädä mallin minimin alle, jolloin se ei tallennu eikä siitä tule virhettä.
Siksi se mitataan eikä oleteta. Admin-näkymä näyttää toteutuneen osuuden.

## Mitä ei ole toteutettu

Tietoisia rajauksia:

- **Ei ääntä.** TTS/STT olisi oma projektinsa eikä muuttaisi mitään mitä tämä näyttää.
- **Ei multi-agenttia.** Yksi agentti neljällä työkalulla riittää näyttämään silmukan.
- **Ei loppukäyttäjien autentikointia.** Webhook on autentikoitu, chat ei.
- **Ei nopeusrajoitusta.** Tuotannossa pakollinen, demossa melua.
- **Ei striimausta.** Vastaus tulee kerralla. Käyttökokemus kärsii, mitattavuus ei.
- **Ei palvelinpuolen fallback-mallia.** Kieltäytyminen käsitellään omana
  lopputuloksenaan (`stop_reason: "refusal"`), mutta varamalliin ei siirrytä.
  Tässä käyttötapauksessa kieltäytyminen on erittäin epätodennäköinen, ja beta-
  parametri maksaisi enemmän monimutkaisuutta kuin toisi arvoa.

## Mitä tekisin seuraavaksi

Järjestyksessä:

1. **Kalibroi hakukynnys oikeilla upotuksilla** ja aja evaluointi. Kaikki muu
   nojaa siihen, että hakukerros erottaa löytyvän löytymättömästä.
2. **Ehdota/vahvista-protokolla.** Nykyinen vahvistusportti tietää, että
   vahvistuskierros oli mahdollinen — ei sitä, mitä vahvistettiin. Ehdotus saa
   tunnisteen, kirjoitus viittaa siihen, ja vartija vertaa sisällön tiivistettä.
   Se siirtäisi rajan 3 kehotteesta koodiin.
3. **Nopeusrajoitus ja kustannuskatto per istunto.** Kirjoituskatto on olemassa,
   lukukatto ei. Kallis silmukka on helppo laukaista.
4. **Hybridihaku.** Pelkkä vektorihaku pettää tuotenumeroilla ja tarkoilla
   termeillä. BM25 rinnalle ja tulosten yhdistäminen.
5. **Ihmisen ohitusreitti.** Nyt agentti joko vastaa tai luo tiketin. Väliin
   tarvitaan siirto ihmiselle kesken keskustelun, historia mukana.
6. **Katkelmatason osumaseuranta.** Mitkä katkelmat päätyvät vastauksiin ja mitkä
   eivät koskaan. Käyttämätön katkelma on joko turha tai löytymätön, ja ne
   vaativat eri korjauksen.

## Rakenne

```
app/page.tsx           chat-UI
app/admin/             admin-näkymä, salasanasuojattu
app/api/chat/          chat-UI:n reitti
app/api/agent/         webhook, jaettu salaisuus
db/index.ts            ajurin valinta URL:n muodosta
db/schema.ts           Drizzle-skeema, pgvector
lib/agent/prompt.ts    järjestelmäkehote + hash
lib/agent/tools.ts     työkalumääritykset ja toteutukset
lib/agent/guards.ts    kirjoituskatto, vahvistusportti, prioriteetin johtaminen
lib/agent/models.ts    hinnasto ja mallikohtaiset kyvyt
lib/agent/loop.ts      agenttisilmukka, lokitus, kustannus
lib/rag/embed.ts       upotukset, eristetty yhteen tiedostoon
lib/rag/search.ts      vektorihaku + osuvuuskynnys
lib/eval/              neljä mittaria + lukitut kynnykset + ajaja + raportti
eval-sets/             testitapaukset JSONina
tests/                 turvakerroksen yksikkötestit
scripts/               migraatiot, siemendata, kynnyksen kalibrointi
content/               tietopohja markdownina, 16 dokumenttia
```
