// Determinisztikus arkalkulacio - a modell nem szamol, csak kimondja az eredmenyt.

export function buildPricingTool(tenant) {
  if (!tenant.pricing.enabled) return null;
  return {
    name: "arkalkulacio",
    description:
      "Kiszámolja a szolgáltatás árát a megadott paraméterek alapján. Ha egy kötelező paraméter hiányzik, az eszköz 'needs' mezőben jelzi vissza, melyik hiányzik - ilyenkor kérdezz vissza a felhasználótól, ne találj ki értéket.",
    input_schema: {
      type: "object",
      properties: {
        helyiseg_szam: { type: "integer", description: "A kezelendő helyiségek száma" },
        hetvege: { type: "boolean", description: "A kezelés hétvégére esik-e" },
        surgosseg: { type: "boolean", description: "Sürgősségi kezelést kér-e" },
        tobb_kezeles: { type: "boolean", description: "Egyszerre több kezelést igényel-e (kedvezmény jár rá)" },
      },
      required: ["helyiseg_szam"],
    },
  };
}

export function calculatePrice(tenant, input) {
  const rules = tenant.pricing.rules || {};

  if (rules.helyiseg_egyseg_ar != null && (input.helyiseg_szam == null || input.helyiseg_szam === "")) {
    return { needs: ["helyiseg_szam"] };
  }

  let total = Number(rules.alapdij) || 0;
  const tetelek = [];
  if (rules.alapdij) tetelek.push({ tetel: "Alapdíj", osszeg: rules.alapdij });

  if (rules.helyiseg_egyseg_ar && input.helyiseg_szam) {
    const reszosszeg = Number(rules.helyiseg_egyseg_ar) * Number(input.helyiseg_szam);
    total += reszosszeg;
    tetelek.push({ tetel: `Helyiségek (${input.helyiseg_szam} db)`, osszeg: reszosszeg });
  }

  if (rules.hetvegi_felar_szazalek && input.hetvege) {
    const felar = Math.round(total * (Number(rules.hetvegi_felar_szazalek) / 100));
    total += felar;
    tetelek.push({ tetel: `Hétvégi felár (${rules.hetvegi_felar_szazalek}%)`, osszeg: felar });
  }

  if (rules.surgossegi_felar_szazalek && input.surgosseg) {
    const felar = Math.round(total * (Number(rules.surgossegi_felar_szazalek) / 100));
    total += felar;
    tetelek.push({ tetel: `Sürgősségi felár (${rules.surgossegi_felar_szazalek}%)`, osszeg: felar });
  }

  if (rules.tobb_kezeles_kedvezmeny_szazalek && input.tobb_kezeles) {
    const kedvezmeny = Math.round(total * (Number(rules.tobb_kezeles_kedvezmeny_szazalek) / 100));
    total -= kedvezmeny;
    tetelek.push({ tetel: `Több kezelés kedvezmény (-${rules.tobb_kezeles_kedvezmeny_szazalek}%)`, osszeg: -kedvezmeny });
  }

  if (rules.minimum_ar && total < Number(rules.minimum_ar)) {
    total = Number(rules.minimum_ar);
  }

  return {
    vegosszeg: total,
    penznem: tenant.pricing.currency,
    tetelek,
    disclaimer: tenant.pricing.disclaimer,
  };
}
