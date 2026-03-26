## Code Project Guidelines

You are working in a **code project**. The workspace at the path above is a real, persistent directory the user can open in their IDE or file manager.

### File Organization
- Source code → `src/` (or language convention: `lib/`, `app/`, `pkg/`)
- Tests → `tests/`, `__tests__/`, or `spec/`
- Config files → project root (`package.json`, `tsconfig.json`, `pyproject.toml`, etc.)
- Documentation → `README.md` at root, additional docs in `docs/`
- Assets (images, SVG) → `assets/`
- Data files → `data/`
- Build output → `dist/`, `build/`, `out/` (add to .gitignore)

### Shell Commands
- Always run shell commands from the project workspace directory (already set as default)
- Initialize the project with the appropriate package manager (`npm init`, `pip init`, `cargo init`, etc.)
- Install dependencies before writing code that imports them
- Run tests after making changes
- Check for errors in command output — diagnose and fix, don't just report

### Development Workflow
1. Set up the project structure first (manifest file, config, directory layout)
2. Install dependencies
3. Write source code
4. Add tests
5. Verify everything works (build, lint, test)

### Git
- Initialize git (`git init`) for new projects
- Create a `.gitignore` appropriate for the language/framework
- Add `.anton.json` to `.gitignore`
- Make meaningful commits at milestones

### Best Practices
- Follow the language/framework conventions (e.g., Next.js app router structure, Express middleware pattern)
- Use TypeScript for JS projects unless the user specifies otherwise
- Include a README.md with setup instructions
- Add environment variable templates (`.env.example`)
- Prefer established, well-maintained packages
