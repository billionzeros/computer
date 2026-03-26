## shadcn/ui

### Philosophy
shadcn/ui is a collection of re-usable components you copy into your project — not a dependency. You own the code and can customize freely.

### Usage Patterns
- Import from your local components: `import { Button } from "@/components/ui/button"`
- Components are in `components/ui/` — edit them directly for project-specific needs
- Use `cn()` utility (clsx + tailwind-merge) to merge classNames safely

### cn() Utility
```tsx
import { cn } from "@/lib/utils"
// Merge conditional classes without conflicts
<div className={cn("px-4 py-2", isActive && "bg-primary text-primary-foreground", className)} />
```

### Variants with cva
```tsx
const buttonVariants = cva("inline-flex items-center rounded-md font-medium transition-colors", {
  variants: {
    variant: { default: "bg-primary text-primary-foreground", outline: "border border-input bg-background" },
    size: { default: "h-10 px-4 py-2", sm: "h-9 px-3", lg: "h-11 px-8" }
  },
  defaultVariants: { variant: "default", size: "default" }
})
```

### Component Conventions
- Forward `ref` on all components
- Accept `className` and spread `...props` on root element
- Use Radix UI primitives under the hood (Dialog, Popover, Select, etc.)
- Theme via CSS variables, not Tailwind color classes directly
- Dark mode: uses `.dark` class on root, CSS variables swap automatically

### Common Components
- **Button**: variants (default, destructive, outline, secondary, ghost, link) + sizes
- **Input/Textarea**: simple styled wrappers, pair with Label
- **Card**: Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
- **Dialog**: Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription
- **Select**: Select, SelectTrigger, SelectValue, SelectContent, SelectItem
- **Table**: Table, TableHeader, TableRow, TableHead, TableBody, TableCell
- **Tabs**: Tabs, TabsList, TabsTrigger, TabsContent
- **Toast**: via sonner — `toast("Message")` or `toast.error("Failed")`

### Theming
Colors defined as HSL in CSS variables:
```css
:root { --primary: 222.2 84% 4.9%; --primary-foreground: 210 40% 98%; }
.dark { --primary: 210 40% 98%; --primary-foreground: 222.2 84% 4.9%; }
```
Reference in Tailwind: `bg-primary`, `text-primary-foreground`, `border-border`, etc.
