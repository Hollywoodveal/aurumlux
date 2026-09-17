# Aurum Books

Create Aurum, a premium mobile-first Progressive Web App (PWA) e-reader that gives users complete ownership of their digital books.

Aurum is not a file manager, desktop library application, or complex organizer.

It is a beautiful offline-first reading experience designed for mobile devices.

The experience should feel like carrying a personal luxury library in your pocket.

Tagline: Where every page is treasured.

---

Core Principles

Mobile-first PWA only

No desktop application architecture

Works fully offline after installation

No account required

No ads

No tracking

No analytics

Local-first storage

User owns all data

Fast and lightweight

EPUB and PDF focused

Minimal but powerful features

Privacy-focused

Designed for phones and tablets

---

Supported Formats

Primary formats:

EPUB

PDF

Architecture should allow future expansion:

CBZ / CBR

MOBI

AZW3

TXT

---

Library Import System

Users can:

Import EPUB files

Import PDF files

Select multiple files

Import books from mobile file picker

Drag and drop files where supported

Re-import updated files

Do not implement folder watching because PWAs cannot reliably support it.

---

Local Storage Architecture

All user data must remain on the device.

Use:

IndexedDB for application data

PWA storage APIs for large files when available

Local caching for covers and metadata

Store locally:

Book files

Metadata

Cover images

Generated spine images

Reading progress

Bookmarks

Highlights

Notes

Settings

The app must work completely offline after initial setup.

---

EPUB Reader

Use epub.js for EPUB rendering and parsing.

Support:

EPUB 2 and EPUB 3

Chapter navigation

Table of contents

Embedded fonts

Images

Media

Internal links

Reading progress tracking

Bookmarks

Highlights

Notes

Reading customization:

Font selection

Font size

Line spacing

Margin control

Light mode

Dark mode

Sepia mode

Smooth page transitions

---

PDF Reader

Use pdf.js for PDF rendering.

Support:

High-performance PDF rendering

Page navigation

Continuous scrolling

Zoom controls

Text selection

Search inside PDF

Basic highlighting

Optimize for mobile performance.

---

Automatic Metadata Extraction

When a book is imported, extract:

Title

Author

Genre

Description

ISBN

Publisher

Publication date

Language

Page count

File format

File size

Embedded cover image

---

Metadata Provider System

If metadata is missing, use this order:

EPUB internal metadata

PDF embedded metadata

Previously cached metadata

Open Library API

Google Books API

Optional ISBN services

Rules:

Merge metadata intelligently

Do not overwrite better existing information

Prefer highest confidence matches

Allow user editing

Respect locked fields

---

Metadata Editing

Users can edit:

Title

Author

Genre

Description

Publisher

ISBN

Language

Series

Rating

Personal notes

Cover image

---

Metadata Locking

Users can lock individual metadata fields.

Locked fields must never be overwritten.

Examples:

Locked title stays unchanged

Locked author stays unchanged

Locked cover stays unchanged

---

Automatic Cover Fetching System

When importing books:

Check EPUB embedded cover

Check PDF embedded cover

Check local cached cover

Search metadata providers

Select highest-quality matching cover

Save cover permanently

Cover requirements:

Automatically fetch covers

Prefer high-resolution images

Cache covers permanently

Never re-fetch cached covers

Allow manual cover replacement

Allow user-uploaded covers

Preserve user-selected covers

Cover storage:

Store covers in IndexedDB or PWA storage

Load instantly from cache

Work offline

Never download the same cover repeatedly

---

Book Spine Display System

Aurum should include an optional digital bookshelf spine view inspired by a physical bookshelf.

Features:

Generate digital book spines from cached cover images

Display cover artwork on the spine whenever possible

Show vertical book title text

Show author name when space allows

Create realistic book thickness based on page count, reading length, or file size

Add subtle shadows and depth effects

Create a premium bookshelf appearance

Users can switch between:

Grid Cover View

Book Spine Bookshelf View

List View

Compact Shelf View

Spine requirements:

Generate spine visuals locally

Use cached covers only

Never download covers again

Store generated spine assets locally

Work offline

Optimize for phones and tablets

Avoid heavy 3D rendering

Interaction:

Tap a book spine to open the book

Swipe through shelves

Browse books visually

Move books between shelves

---

Bookshelf Experience

The library should feel like a digital bookshelf.

Features:

Book covers displayed in grid view

Optional spine bookshelf view

Smooth swipe navigation

Tap to open book animation

Subtle shadows

Depth effects

Responsive mobile layout

Views:

Grid View (default)

List View

Compact Shelf View

Spine View

---

Library Organization

Keep organization simple.

Shelves:

All Books

Currently Reading

Finished

Want to Read

Favorites

Filters:

Author

Genre

Rating

Do not add:

Smart collections

AI organization

Complex automation

---

Reading Status

Support:

Currently Reading

Finished

Want to Read

Favorites

Finished books include:

Finish date

Re-read counter

---

Reading Tools

Support:

Bookmarks

Highlights

Highlight colors

Notes

Search inside book

Reading progress tracking

---

Reading Progress

Track:

Current page

Current chapter

Percentage complete

Last opened position

Reading time

Finished status

---

Search

Global search:

Book titles

Authors

Genres

Notes

Highlights

No full-text indexing required.

---

Statistics

Keep statistics minimal:

Total books

Books finished

Currently reading count

Approximate pages read

No complex dashboards.

---

Backup System

Support:

Export library as JSON

Import backups

Restore library

Manual backup download

Future option:

Cloud sync disabled by default

---

Visual Design System – Black & Gold Premium UI

Aurum should use a luxury black and gold design inspired by a premium private library.

Default application theme:

Matte black background

Metallic gold accents

Warm ivory text

Dark charcoal surfaces

Color palette:

Background: deep black

Primary accent: elegant gold

Secondary: charcoal

Text: soft white / ivory

The interface should feel:

Luxury

Calm

Elegant

Minimal

Premium

Book-focused

Apply this design to:

Home screen

Bookshelves

Book cards

Spine view

Navigation

Buttons

Settings

Reader controls

Progress indicators

Use:

Gold borders

Soft shadows

Subtle glow effects

Elegant depth

Avoid:

Bright colors

Clutter

Excessive gradients

Distracting animations

Animations:

Smooth book opening

Gentle shelf movement

Elegant page transitions

Subtle gold lighting effects

Keep animations lightweight.

---

Reading Themes

Reader modes:

Light

Dark

Sepia

The main app UI should remain Black & Gold.

---

Performance Requirements

Optimize for:

Fast startup

Low-end devices

Smooth scrolling

Lazy loading

Efficient EPUB rendering

Efficient PDF rendering

Instant cached cover loading

Offline operation

---

Home Screen

The home screen is the library.

Show:

Recently opened books

Currently Reading section

Main bookshelf

Simple navigation

Do not create:

Dashboards

Complicated menus

Unnecessary screens

---

Privacy

Aurum must:

Require no account

Store data locally

Avoid tracking

Avoid analytics

Avoid advertisements

Respect user ownership

---

Final Product Goal

Create Aurum as a beautiful personal digital library.

The application should feel:

Calm

Fast

Lightweight

Private

Personal

Offline-first

Premium

Book-focused

The goal is not file management.

The goal is to make reading digital books feel like owning a beautiful black-and-gold personal bookshelf on a mobile device.

Also add stats like heat map, genres, and author cloud, a way to sort books and the ability to deleted added books. it is very important to Add ability to edit metadata and delete books that have been added and make spine view the default view and make the default title A-Z when books are imported. Make the titles on the spines as legible as possible. and when I click a spine make want to bring up the details and from there I can click read if I want. I also want the ability to lock metadata. And make sure the import button works right

---

## Project

Aurum Books is a React 19 + TanStack Start app, built with Vite and Tailwind 4,
shipped as an offline-first PWA. Reading happens entirely on the device: books
are stored in IndexedDB and never uploaded.

**Live app:** https://aurumlux.daiyveal.workers.dev

## Development

You need [Bun](https://bun.sh).

```sh
git clone https://github.com/Hollywoodveal/aurumlux.git
cd aurumlux
bun install
bun run dev      # http://localhost:8080
```

```sh
bun run build    # production build into .output/
bun run lint     # eslint
npx tsc --noEmit # typecheck
```

## Deployment

The app is deployed to Cloudflare Workers. The build emits a ready-to-use
Wrangler config, which the `deploy` script points at:

```sh
bun run build
bun run deploy
```

Wrangler is pinned as a devDependency, so both commands use the version in
`bun.lock` rather than whatever `npx` happens to resolve. Wrangler itself needs
Node.js 22 or newer.

Pushes to `main` are built and deployed automatically by Cloudflare Workers
Builds.

Cache rules live in `public/_headers`: `sw.js` and the Workbox runtime are always
revalidated so installed users pick up new builds, hashed files under `/assets/`
are cached immutably for a year, and the web manifest is cached for an hour.
