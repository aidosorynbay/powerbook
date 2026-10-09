# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary for now: newcomers arriving by link.** This is someone who has never seen PowerBook. They open a link a reader shared (`/r/<username>` from «Поделиться днём», the shared `/round` link) or a social post, usually on a phone. Some will be outside Kazakhstan and use the English version. Their job:
- understand, in about a minute, what PowerBook is and what it asks of them;
- then sign up for the circle, or for the waiting list when registration is closed.

Design decisions are ranked first by how well they serve this person.

**Always protected: current members.** These are readers already in the monthly circles. They are Russian- and Kazakh-speaking, and many date from the Telegram era. Their daily job:
- log the day's minutes quickly;
- see their calendar, streak and place;
- keep going to the end of the circle.

Work for newcomers must never make this daily ritual slower or more confusing. A separate pass dedicated to current members is planned after the newcomer work.

**Later, not the focus yet:** organisers (companies, universities, reading clubs) who want circles for their own people. This is the intended first paying segment.

## Product Purpose

PowerBook makes reading a daily habit through monthly group challenges. Each month is a circle («круг»):
- readers sign up on days 1–10;
- they read at least 30 minutes every day;
- they log the day's minutes before sleep, and fill them in at least once a week;
- a day of 30+ minutes scores 1 point;
- the table is ranked by consistency, the number of 30-minute days, not by speed or by number of books;
- at the end, the bottom half of the table gives a book to someone from the top half.

Success is a reader who keeps reading every day, through the circle and after it. In the product's own words: «Ноль превратился в тридцать минут, тридцать минут — в ещё один день, а день — в привычку».

## Positioning

PowerBook is a community that has run a monthly reading circle every month since February 2021. It started as three friends with a shared spreadsheet and grew by word of mouth to 1000+ readers. The history of every circle now lives on the platform.

The mechanism is the product:
- a fixed monthly circle;
- a 30-minute daily minimum, logged in minutes;
- ranking by consistency;
- a real book exchange at the end.

It is not a reading tracker, a book catalogue or a speed contest.

## Operating Context

- **Devices:** mostly phones. Test at 390×664, the visible height of iPhone Safari. The same frontend also ships as iOS and Android apps through the Capacitor shell (`app-shell/`).
- **Time:** days close at bedtime, Astana time. The last day of a circle is for corrections until 20:00 Astana time and is not scored.
- **The month's rhythm:** registration on days 1–10 (late arrivals join the waiting list for the next circle), daily logging, the final table, the book exchange.
- **Reading room:** many readers read in «Читальный зал». Its timer writes minutes into «Сегодня».
- **Sharing:** readers share a day to WhatsApp, Telegram, X and Instagram stories; that is the growth loop.
- **Telegram:** the community began in a Telegram group, and the group still exists. The website is now where circles are run and recorded.

## Capabilities and Constraints

- **What exists:**
  - the circle page («Сегодня», calendar, streak, leaderboard);
  - the archive of all circles, results with a personal circle review, and the hall of fame;
  - the reading room;
  - «Моя библиотека», a 3D shelf with notes and marks;
  - «Общая библиотека», with ratings;
  - «Книжный базар»;
  - the reading recap and AI letters;
  - «Поделиться днём» with story stickers;
  - the notification bell;
  - claimable archive profiles for Telegram-era readers;
  - the waiting list.
- **Minutes, never pages.** Every text describes logging minutes per day.
- **Terminology:** the monthly challenge is «круг» in Russian and "circle" in English («reading circle»), everywhere. Kazakh keeps «раунд».
  - Some Russian strings still say «Раунд», including the bottom nav (`nav.round`), and some English strings still say "round". Both are to be migrated.
- **Three languages for every string:** ru, kk and en, in `frontend/src/shared/lib/i18n.tsx`. Kazakh strings often run longer, and layouts must survive them.
- **Existing members stay free forever.** Money may come only from new segments: organisers, sponsors, the book market. No paywall, deposit or paid tier may take anything away from current members.
- **Data and analytics:** personal data is stored on servers in Kazakhstan. Analytics use account ids only, never names or e-mails.
- **Themes:** dark by default, plus light and system.
- **Open decisions:**
  - what the paid offer for new segments will be;
  - what the organiser surfaces will look like.

## Brand Commitments

- **Name:** PowerBook (powerbook.kz).
- **Lines in use:** «Понемногу, но постоянно.» and «Сделаем чтение брендом.»
- **Origin story:** founded during the 2021 lockdown by Айсултан, Нурбол and Мадияр (the `about.*` strings).
- **Voice:** plain, warm and honest, with no hype about speed or volume. The current Russian copy addresses readers as «вы».
- **Price promise:** free to join, no hidden fees («Бесплатная регистрация», «Без скрытых платежей»).

## Evidence on Hand

- **Real history:** every circle since 2021 is on the platform (archive, hall of fame, the home page growth chart), and 1000+ readers have taken part.
- **Real community content:**
  - readers' shelves, marks and reviews;
  - shared days and story stickers;
  - the reading room's readers.
- **Not available:** collected testimonials, press quotes, partner logos. Do not invent them.

## Product Principles

1. **Consistency over volume.** Every surface rewards showing up each day, not reading faster or more.
2. **A newcomer understands in a minute** what PowerBook is, what it asks (30 minutes a day, honest minutes, a book at the end) and when the next circle starts.
3. **The daily ritual stays fast.** Logging today's minutes is the most frequent action, and nothing new goes in front of it.
4. **Worth sharing.** Growth is organic, so a reader's day, streak or finished book should be something they want to post.
5. **The community's history is the proof.** Show real readers and real circles instead of claims.

## Accessibility & Inclusion

- **Languages:** Russian, Kazakh and English are equal.
  - Kazakh Cyrillic letters (ә ғ қ ң ө ұ ү һ і) must render in every font used.
  - Longer Kazakh strings must not break layouts.
- **Phones first:** the main experience is a phone, both in the browser and in the app shell.
