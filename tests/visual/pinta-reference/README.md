# Native Pinta screenshot references

These screenshots are captured from the bundled original desktop Pinta source by `npm run test:visual:native`. Each PNG uses the exact filename of the corresponding approved web screenshot in `../__screenshots__/chromium/`.

The reproducible reference environment is a disposable `linux/amd64` Arch container with .NET 10, GTK4, libadwaita, Xvfb, Openbox, AT-SPI, a 1440 × 960 Pinta window, English locale, 100% scale, default blue accent, and explicit light/dark schemes. See `../README.md` for the deliberate platform-owned and web-only comparison states.

Run `npm run test:visual:review` to generate the side-by-side comparison gallery.
