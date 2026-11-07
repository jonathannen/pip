// Load <project>/.dev.vars regardless of cwd (MCP clients spawn the stdio entry from anywhere), the
// same file `vite dev` reads. Works from both src/ and dist/, one level below the project root.
try {
  process.loadEnvFile(new URL('../.dev.vars', import.meta.url));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw error;
  }
}
