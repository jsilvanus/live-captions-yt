---
title: "LCYT kehittyy ja laajenee"
date: "2026-03-18"
description: "Feature bloat on todellisuutta"
language: fi-FI
author: jsilvanus
---

# Feature bloat on todellisuutta

## Lähtökohta

Tämä projekti alkoi tarpeeseen tulevana tekstitysohjelmana. Ongelma oli tämä: [EU:n saavutettavuusdirektiivi](https://www.saavutettavuusvaatimukset.fi/fi/digipalvelulain-vaatimukset) vaatii, että kaikki julkisoikeudellisten toimijoiden videot tekstitetään. Tällä on paitsi saavutettavuusnäkökulma, myös se puoli, että nykyään [suuri osa aikuisista katsoo videot ilman ääniä](https://www.forbes.com/sites/tjmccue/2019/07/31/verizon-media-says-69-percent-of-consumers-watching-video-with-sound-off/) - myös minä itse. Ylipäänsä median käyttö on lähtökohtaisesti äänetöntä, suurena poikkeuksena tosin ajomatkat.

Taustalla oli monien vuosien suunnittelu. Olen suunnitellut tekstitystyökalua ja itse asiassa toteuttanut C#:lla yhden viitisen vuotta sitten. En koskaan antanut sitä suurempaan jakeluun. Mutta nyt, kun **vibe coding** on tullut ja mahdollistaa in house -kehityksen aivan eri tavalla, päätin, että oli tullut aika tehdä projekti loppuun.

Projekti alkoi peruskirjastosta (lcyt), johon aluksi sisältyi komentoriviappi (CLI). Aika pian syntyi kuitenkin ajatus kirjaston käyttämisestä myös web appin kautta, joten CLI erotettiin kirjastosta. Kirjaston käyttämisessä verkkokäyttöliittymässä on yksi perusongelma: [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS). Jos selain lähettää domainissa *domain.com* kutsun Youtubelle, se voi kyllä lähettää viestin, mutta se ei ota vastaan mitään sisältöä Youtubelta, ellei Youtube sano lähettävänsä tietoa *domain.comille*. Tämän vuoksi verkkokäyttöliittymä ei saisi sitä tietoa, mitä Youtube palauttaa (kellonaika, virhetiedot, tieto läpimenosta).

## Web App ja Backend

Ratkaisu tähän oli rakentaa **backend** (lcyt-backend) ja siihen yhteyden ottava **web ui** (lcyt-web). Samalla peruskirjastoon lisättiin lähetys taustapalveluun. Ajatus on, että useat eri domainit voivat käyttää samaa backendia, jos näin halutaan.

**Web App** eli ensin itsekseen ja pian sen kanssa tuli **Astrolla** tehty ohjesivusto. Tekoäly tosin nimittää sitä **CLAUDE.md**:ssä *markkinointisivustoksi*. Potato, potata.

Tässä olikin hyvä lähtökohta sitten alkaa laajentaa ominaisuuksia... Palaan siihen seuraavassa kirjoituksessa. 