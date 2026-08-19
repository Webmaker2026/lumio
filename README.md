# Lumio

Beágyazható AI chat widget magyar szolgáltató kkv-k weboldalára. A widget az adott ügyfél saját weboldalának tartalmából és kézzel megadott tudásanyagából válaszol, felajánlja a szolgáltatást, árat kalkulál, és elkéri az érdeklődő telefonszámát. Egy backend szolgál ki több ügyfelet (multi-tenant): új ügyfél bekötése egy config létrehozásából és egy `<script>` sor beillesztéséből áll, kódot nem kell módosítani.

## Tech stack

- Vercel Node.js serverless functions, vanilla JavaScript (ESM), build lépés nélkül
- Upstash Redis a REST API-ján keresztül (`fetch`, nincs SDK)
- Anthropic Messages API közvetlen `fetch`-csel (nincs `@anthropic-ai/sdk`)
- Resend REST API az e-mail értesítésekhez
- A widget egyetlen önálló `public/widget.js`, Shadow DOM-ban, framework nélkül
- `dependencies` a `package.json`-ban üres

## Deploy Vercelre

1. Hozz létre egy GitHub repót, és pushold bele ezt a projektet.
2. A [vercel.com/new](https://vercel.com/new) oldalon importáld a repót.
3. **Storage** fülön hozz létre egy Upstash Redis adatbázist, és kösd össze a projekttel (ez automatikusan felveszi a `KV_REST_API_URL` / `KV_REST_API_TOKEN` stb. változókat).
4. **Settings → Environment Variables** alatt vedd fel a lenti env változókat (az Upstash URL/token értékét a `KV_REST_API_URL` / `KV_REST_API_TOKEN` változókból másold át).
5. Deploy. Minden további `git push` a `main` branch-re automatikusan újra deployol.
6. Ellenőrzés: `GET https://<domained>/api/health` → `{"ok":true,"redis":"ok"}`.

## Környezeti változók

```
ANTHROPIC_API_KEY=       # Anthropic API kulcs (console.anthropic.com)
UPSTASH_REDIS_REST_URL=  # Upstash Redis REST URL
UPSTASH_REDIS_REST_TOKEN=# Upstash Redis REST token
ADMIN_PASSWORD=          # az admin felület belépő jelszava
RESEND_API_KEY=          # Resend API kulcs (resend.com)
LEAD_FROM_EMAIL=         # honnan menjen ki a lead-értesítő email (Resenden weboldalán hitelesített domain)
PUBLIC_BASE_URL=         # a Vercel deploy publikus URL-je, pl. https://lumio-xyz.vercel.app
```

Titok soha nem kerül a `widget.js`-be vagy semmilyen kliensoldali fájlba.

## Új ügyfél bekötése (kb. 10 perc)

1. Nyisd meg az admin felületet: `https://<domained>/admin`, jelentkezz be az `ADMIN_PASSWORD`-del.
2. **"+ Új"** gomb → töltsd ki az Alapadatok fület: tenant id (pl. `pelda-cegnev`), cégnév, engedélyezett domainek, bot neve/hangneme, szín.
3. **Tudásanyag** fülön: add meg az ügyfél weboldalának kezdő URL-jét, és nyomd meg a **"Weboldal beolvasása"** gombot — ez feltölti a `siteKnowledge`-t. Emellett a **Kézi tudásanyag** mezőbe írd be, amit a crawler nem tud megtalálni (árlista, GYIK, speciális infók).
4. **Árazás** fülön ha kell árkalkuláció: pipáld be, és a `pricing.rules` JSON mezőben add meg a szabályokat (lásd a seed `tenants/agyipoloskastop.json` fájlt példának).
5. **Lead** fülön ha kell érdeklődő-rögzítés: pipáld be, add meg az értesítési e-mail címet és az adatkezelési tájékoztató URL-jét.
6. Nyomd meg a **Mentés**-t.
7. **"Beágyazó kód másolása"** gomb → illeszd be az ügyfél weboldalába a `</body>` elé:
   ```html
   <script src="https://<domained>/widget.js" data-client="<tenant-id>" defer></script>
   ```
8. Az **Élő próba** fülön próbáld ki élesben, mielőtt kimegy az ügyfélhez.

## Tudásanyag frissítése

- **Weboldal újra beolvasása**: admin → az adott ügyfél → Tudásanyag fül → "Weboldal beolvasása" gomb újra megnyomva. Ez felülírja a `siteKnowledge` mezőt és frissíti az időbélyeget.
- **Kézi tudásanyag**: admin → Tudásanyag fül → szerkeszd a textareát → Mentés. Ez élvez elsőbbséget a weboldalról begyűjtött szöveggel szemben, ha ellentmondás van.
- A tudásanyag a `limits.maxKnowledgeChars` értéknél (alapértelmezés 60 000 karakter) levágásra kerül; a levágás a szerver logban látszik.

## Kézi tesztlista

1. `vercel dev` (vagy egy friss deploy) hibátlanul elindul.
2. `public/demo.html` megnyitva a widget megjelenik jobb alsó sarokban, kattintásra kinyílik, és értelmes választ ad az `agyipoloskastop` tudásanyagából.
3. Egy nem engedélyezett domainről a widget `/api/chat` hívása 403-at kap.
4. Az árkalkulátor hiányzó paraméternél (pl. helyiségszám) visszakérdez, nem talál ki számot.
5. A lead rögzítés (nev + telefon + hozzájárulás megadása után) e-mailt küld, és megjelenik az admin Leadek listájában.
6. 30 gyors üzenet után (egy percen belül, ugyanarról az IP-ről) 429-es hiba jön, emberi hibaüzenettel és telefonszámmal.
7. A `widget.js` fájl teljes tartalma megnézve nincs benne egyetlen API kulcs vagy titok sem.
8. A widget WordPress-be (vagy bármilyen más CSS-sel rendelkező oldalba) ágyazva sem tör el, mert Shadow DOM-ban fut.
9. Mobil nézetben (vagy szűk böngészőablakban) a widget teljes képernyős, `Tab`/`Shift+Tab` a panelen belül csapdázva marad, `Esc` bezárja.
10. Admin felület: tenant létrehozás/szerkesztés/deaktiválás/törlés, leadek CSV exportja, havi statisztika helyesen jelenik meg.

## Becsült futási költség

A modell `claude-haiku-4-5` (bemenet: $1 / millió token, kimenet: $5 / millió token). Egy átlagos fordulóban (system prompt + eddigi beszélgetés + válasz) kb. 1500–2500 bemeneti és 200–500 kimeneti tokent használunk a rendszerprompt méretétől (tudásanyag hossza) függően — ez kb. **$0.002–0.005 (kb. 0.7–2 Ft) fordulónként**. Egy tipikus, 4-5 üzenetváltásos beszélgetés (a lead rögzítéssel együtt) így nagyjából **$0.01–0.02 (4–8 Ft)**. A tényleges token-felhasználás az admin **Statisztika** fülén tenantonként és hónaponként pontosan látszik (`stats:<tenant>:<hó>` Redis hash), így ebből lehet a valós költséget visszaszámolni.

## Nyitott kérdések

A specifikáció néhány pontján a legegyszerűbb működő megoldást választottam, ahol a spec nem tért ki rá explicit módon:

1. **Widget config lekérése**: a fájlstruktúra nem definiált külön végpontot a widget induló adataihoz (persona/theme/escalation). Megoldás: `GET /api/chat?tenantId=...` adja vissza ezeket, ugyanazzal a CORS-ellenőrzéssel, mint a `POST` — nincs külön fájl.
2. **CORS preflight és admin élő próba**: a böngésző `OPTIONS` kérésének nincs body-ja, ezért a `tenantId`-t query paraméterként is el kell tudni olvasni. Az admin élő próba pedig ugyanarról a domainről hívja az API-t (nem a tenant `allowedOrigins` listájáról) — ezt egy admin `Authorization: Bearer` fejléc alapú kivétellel oldottam meg a CORS-ellenőrzésben.
3. **Widget lazy init időzítése**: a spec szerint a config csak kattintásra töltődjön be, de a launcher "signature animáció" (felirat megjelenítése első görgetésnél) ehhez már ismernie kellene a `launcherLabel`-t. Megoldás: a config lekérése az első görgetéskor (vagy ha az korábban történik, a kattintáskor) indul — így az oldal betöltését nem lassítja, de az animáció is működik.
4. **Lead hozzájárulási checkbox**: a spec egy "lead form fölötti" checkboxot ír le. Mivel a lead rögzítés a beszélgetésen belül, a modell által hívott eszközön keresztül történik (nem külön form), a widget egy állandóan látható hozzájárulási jelölőnégyzetet és adatkezelési linket mutat a beviteli mező fölött, amikor a tenant `lead.enabled`. A tényleges hozzájárulást a beszélgetésben a modell kérdezi meg, és ez kerül át a `lead_rogzites` eszköz `hozzajarulas` mezőjébe.
5. **Meglévő, kézzel Redisbe feltöltött seed tenant**: ha az `agyipoloskastop` tenantot a fejlesztés közben kézzel (Upstash CLI-vel) töltötted fel `SET tenant:agyipoloskastop ...` paranccsal, az admin tenant-listája nem fogja mutatni, mert nincs benne a `tenants:index` Redis halmazban. Nyisd meg egyszer az admin felületen, mentsd el újra (vagy hozd létre újra "+ Új"-val ugyanazzal az id-vel) — ez felveszi az indexbe.
