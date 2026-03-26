## Document Project Guidelines

You are working in a **document project**. The workspace is a persistent directory for the user's documents and supporting files.

### File Organization
- Primary document(s) → project root (`report.docx`, `memo.md`, etc.)
- Supporting data → `data/` (spreadsheets, CSVs, raw data)
- Charts and visualizations → `charts/` or `assets/`
- Drafts → `drafts/` (keep previous versions here)
- Images → `assets/`

### Document Workflow
1. Create the primary document file first
2. Gather or generate supporting data
3. Create visualizations/charts if needed
4. Assemble the final document
5. Save drafts before making major revisions

### Artifact Usage
- Use the `artifact` tool to preview documents (markdown, HTML) in the side panel
- For charts and diagrams, use SVG or mermaid artifacts
- Save final outputs as real files in the workspace, not just artifacts

### Best Practices
- Use descriptive filenames (not `doc1.md`)
- Keep a clear separation between raw data and final outputs
- When revising, save the old version to `drafts/` first
