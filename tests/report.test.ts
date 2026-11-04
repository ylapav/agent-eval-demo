import { test } from "node:test";
import assert from "node:assert/strict";
import { hakuTila, refusalHuomio } from "../lib/eval/report";

/**
 * Lukitsee kieltäytymissarjan huomautuksen.
 *
 * Ensimmäisessä oikeassa ajossa huomautus sanoi "10/10 tapauksessa
 * hakukynnys palautti tyhjän tuloksen, kuten pitääkin", vaikka agentti ei
 * ollut hakenut kertaakaan. Nolla katkelmaa on kolme eri asiaa, ja vain
 * yksi niistä kertoo kynnyksestä.
 */

test("ei hakukutsua → ei_kutsuttu, vaikka katkelmia on nolla", () => {
  assert.equal(hakuTila(false, 0), "ei_kutsuttu");
});

test("haku ja nolla katkelmaa → tyhja (kynnys karsi)", () => {
  assert.equal(hakuTila(true, 0), "tyhja");
});

test("haku ja katkelmia → osumia", () => {
  assert.equal(hakuTila(true, 3), "osumia");
});

test("huomautus erottaa kolme tilaa eikä kehu kynnystä ilman hakua", () => {
  const h = refusalHuomio(["ei_kutsuttu", "ei_kutsuttu", "tyhja", "osumia"]);
  assert.equal(
    h,
    "4 tapausta: 2 agentti ei kutsunut hakua, 1 haku palautti tyhjän kynnyksen takia, 1 haku palautti katkelmia.",
  );
  assert.doesNotMatch(refusalHuomio(["ei_kutsuttu"]), /kuten pitääkin/);
});
