export {};
const password = process.env.ADMIN_PASSWORD;
if (!password) {
  console.error(
    "Set ADMIN_PASSWORD temporarily in your environment, then run bun run password:hash. The password is never printed.",
  );
  process.exit(1);
}
console.log(await Bun.password.hash(password));
