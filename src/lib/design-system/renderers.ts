/**
 * Static lazy imports keep every checked-in shadcn component available to Vite while
 * avoiding a 56-component eager bundle in the editor. The manifest resolves the
 * named export for an instance when an HTML renderer is actually mounted.
 */
export const shadcnModuleLoaders = {
  accordion: () => import('$lib/components/ui/accordion/index.js'),
  alert: () => import('$lib/components/ui/alert/index.js'),
  'alert-dialog': () => import('$lib/components/ui/alert-dialog/index.js'),
  'aspect-ratio': () => import('$lib/components/ui/aspect-ratio/index.js'),
  avatar: () => import('$lib/components/ui/avatar/index.js'),
  badge: () => import('$lib/components/ui/badge/index.js'),
  breadcrumb: () => import('$lib/components/ui/breadcrumb/index.js'),
  button: () => import('$lib/components/ui/button/index.js'),
  'button-group': () => import('$lib/components/ui/button-group/index.js'),
  calendar: () => import('$lib/components/ui/calendar/index.js'),
  card: () => import('$lib/components/ui/card/index.js'),
  carousel: () => import('$lib/components/ui/carousel/index.js'),
  chart: () => import('$lib/components/ui/chart/index.js'),
  checkbox: () => import('$lib/components/ui/checkbox/index.js'),
  collapsible: () => import('$lib/components/ui/collapsible/index.js'),
  command: () => import('$lib/components/ui/command/index.js'),
  'context-menu': () => import('$lib/components/ui/context-menu/index.js'),
  'data-table': () => import('$lib/components/ui/data-table/index.js'),
  dialog: () => import('$lib/components/ui/dialog/index.js'),
  drawer: () => import('$lib/components/ui/drawer/index.js'),
  'dropdown-menu': () => import('$lib/components/ui/dropdown-menu/index.js'),
  empty: () => import('$lib/components/ui/empty/index.js'),
  field: () => import('$lib/components/ui/field/index.js'),
  form: () => import('$lib/components/ui/form/index.js'),
  'hover-card': () => import('$lib/components/ui/hover-card/index.js'),
  input: () => import('$lib/components/ui/input/index.js'),
  'input-group': () => import('$lib/components/ui/input-group/index.js'),
  'input-otp': () => import('$lib/components/ui/input-otp/index.js'),
  item: () => import('$lib/components/ui/item/index.js'),
  kbd: () => import('$lib/components/ui/kbd/index.js'),
  label: () => import('$lib/components/ui/label/index.js'),
  menubar: () => import('$lib/components/ui/menubar/index.js'),
  'native-select': () => import('$lib/components/ui/native-select/index.js'),
  'navigation-menu': () => import('$lib/components/ui/navigation-menu/index.js'),
  pagination: () => import('$lib/components/ui/pagination/index.js'),
  popover: () => import('$lib/components/ui/popover/index.js'),
  progress: () => import('$lib/components/ui/progress/index.js'),
  'radio-group': () => import('$lib/components/ui/radio-group/index.js'),
  'range-calendar': () => import('$lib/components/ui/range-calendar/index.js'),
  resizable: () => import('$lib/components/ui/resizable/index.js'),
  'scroll-area': () => import('$lib/components/ui/scroll-area/index.js'),
  select: () => import('$lib/components/ui/select/index.js'),
  separator: () => import('$lib/components/ui/separator/index.js'),
  sheet: () => import('$lib/components/ui/sheet/index.js'),
  sidebar: () => import('$lib/components/ui/sidebar/index.js'),
  skeleton: () => import('$lib/components/ui/skeleton/index.js'),
  slider: () => import('$lib/components/ui/slider/index.js'),
  sonner: () => import('$lib/components/ui/sonner/index.js'),
  spinner: () => import('$lib/components/ui/spinner/index.js'),
  switch: () => import('$lib/components/ui/switch/index.js'),
  table: () => import('$lib/components/ui/table/index.js'),
  tabs: () => import('$lib/components/ui/tabs/index.js'),
  textarea: () => import('$lib/components/ui/textarea/index.js'),
  toggle: () => import('$lib/components/ui/toggle/index.js'),
  'toggle-group': () => import('$lib/components/ui/toggle-group/index.js'),
  tooltip: () => import('$lib/components/ui/tooltip/index.js'),
} as const;

export type InstalledComponentDirectory = keyof typeof shadcnModuleLoaders;

export async function loadShadcnExport(directory: InstalledComponentDirectory, exportName: string) {
  const module = (await shadcnModuleLoaders[directory]()) as Record<string, unknown>;
  const component = module[exportName];
  if (!component) {
    throw new Error(`Missing ${exportName} export from shadcn component directory ${directory}`);
  }
  return component;
}
