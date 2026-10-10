# Blog

This blog uses [hugo](https://gohugo.io/). After installing it, you can start the server with the following command:

```bash
hugo serve
```

You should be able to access the app on localhost:1313.

The deployed version of the app is managed by [netlify](https://app.netlify.com/). 

Live app: [https://gabrielaleks.com](https://gabrielaleks.com/)

### Git hooks
A pre-commit hook in `.githooks/` refuses commits with images or videos that contain GPS location data. It needs [exiftool](https://exiftool.org/) (`brew install exiftool`) and has to be enabled once per clone:

```bash
git config core.hooksPath .githooks
```

To strip the metadata from a file it flags (keeping the orientation), then stage it again:

```bash
exiftool -all= -tagsfromfile @ -Orientation -overwrite_original <file>
```