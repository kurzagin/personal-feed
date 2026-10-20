await Bun.build({
  entrypoints: ["./src/main.tsx"],
  outdir: "./dist",
  minify: true,
  target: "browser",
});
console.log("Built web client with Bun.build!");
