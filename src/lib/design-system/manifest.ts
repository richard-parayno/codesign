import { z } from 'zod';
import { loadShadcnExport, type InstalledComponentDirectory } from '$lib/design-system/renderers';

export type ComponentCategory =
  'actions' | 'data-display' | 'feedback' | 'forms' | 'layout' | 'navigation' | 'overlays';

export type ComponentPropDefinition = {
  kind: 'boolean' | 'enum' | 'number' | 'string';
  default?: unknown;
  options?: readonly (boolean | number | string)[];
  description: string;
};

export type ComponentSlotDefinition = {
  id: string;
  displayName: string;
  accepts: readonly string[];
  required?: boolean;
  maxChildren?: number;
};

export type ComponentPartDefinition = {
  id: string;
  displayName: string;
  exportName: string;
  editableContent: boolean;
  slots: readonly ComponentSlotDefinition[];
};

export type ComponentBlueprintNode = {
  key: string;
  componentId: string;
  parentKey?: string;
  slot: string;
  content?: string;
  props: Record<string, unknown>;
};

export type CodesignComponentDefinition = {
  id: string;
  directory: InstalledComponentDirectory;
  displayName: string;
  category: ComponentCategory;
  description: string;
  importPath: string;
  exportName: string;
  defaultSize: { width: number; height: number };
  defaultContent: string;
  editableContent: boolean;
  props: Readonly<Record<string, ComponentPropDefinition>>;
  slots: readonly ComponentSlotDefinition[];
  parts: readonly ComponentPartDefinition[];
  defaultComposition: readonly ComponentBlueprintNode[];
  /** How the checked-in shadcn source can be mounted safely on the canvas. */
  renderStrategy: 'native' | 'compound' | 'fallback';
  interaction: {
    edit: 'selection-only';
    preview: 'enabled' | 'static';
  };
  codegen: {
    importPath: string;
    exportName: string;
    importStyle: 'named' | 'namespace';
    omitProps?: readonly string[];
    propValueAliases?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  };
  load: () => Promise<unknown>;
};

type ComponentSpec = {
  directory: InstalledComponentDirectory;
  id: string;
  displayName?: string;
  category: ComponentCategory;
  description: string;
  exportName: string;
  size: readonly [number, number];
  content?: string;
  props?: Readonly<Record<string, ComponentPropDefinition>>;
  parts?: readonly string[];
  interactive?: boolean;
  accepts?: readonly string[];
  composition?: readonly {
    key: string;
    exportName: string;
    parentKey?: string;
    content?: string;
  }[];
  renderStrategy?: CodesignComponentDefinition['renderStrategy'];
  codegen?: Pick<CodesignComponentDefinition['codegen'], 'omitProps' | 'propValueAliases'>;
};

const enumProp = (
  description: string,
  options: readonly (boolean | number | string)[],
  defaultValue: boolean | number | string,
): ComponentPropDefinition => ({ kind: 'enum', description, options, default: defaultValue });
const booleanProp = (description: string, defaultValue = false): ComponentPropDefinition => ({
  kind: 'boolean',
  description,
  default: defaultValue,
  options: [true, false],
});
const stringProp = (description: string, defaultValue = ''): ComponentPropDefinition => ({
  kind: 'string',
  description,
  default: defaultValue,
});
const numberProp = (description: string, defaultValue: number): ComponentPropDefinition => ({
  kind: 'number',
  description,
  default: defaultValue,
});

const disabled = booleanProp('Whether interaction is disabled.');
const orientation = enumProp('Layout orientation.', ['horizontal', 'vertical'], 'horizontal');
const open = booleanProp('Whether the overlay or disclosure is open.');
const value = stringProp('Current editable value.');

const specs = [
  {
    directory: 'accordion',
    id: 'Accordion',
    category: 'layout',
    description: 'Vertically stacked disclosure sections.',
    exportName: 'Accordion',
    size: [320, 144],
    parts: ['AccordionItem', 'AccordionTrigger', 'AccordionContent'],
    props: { type: enumProp('Selection behavior.', ['single', 'multiple'], 'single'), disabled },
    interactive: true,
  },
  {
    directory: 'alert',
    id: 'Alert',
    category: 'feedback',
    description: 'Status message with title, detail, and optional action.',
    exportName: 'Alert',
    size: [360, 84],
    content: 'Heads up',
    parts: ['AlertTitle', 'AlertDescription', 'AlertAction'],
    composition: [
      { key: 'title', exportName: 'AlertTitle', content: 'Heads up' },
      {
        key: 'description',
        exportName: 'AlertDescription',
        content: 'This interface can be edited directly.',
      },
      { key: 'action', exportName: 'AlertAction', content: 'Dismiss' },
    ],
    props: { variant: enumProp('Visual emphasis.', ['default', 'destructive'], 'default') },
  },
  {
    directory: 'alert-dialog',
    id: 'AlertDialog',
    category: 'overlays',
    description: 'Modal confirmation requiring an explicit decision.',
    exportName: 'AlertDialog',
    size: [420, 220],
    content: 'Are you sure?',
    parts: [
      'AlertDialogTrigger',
      'AlertDialogContent',
      'AlertDialogHeader',
      'AlertDialogTitle',
      'AlertDialogDescription',
      'AlertDialogFooter',
      'AlertDialogCancel',
      'AlertDialogAction',
    ],
    props: { open },
    interactive: true,
  },
  {
    directory: 'aspect-ratio',
    id: 'AspectRatio',
    category: 'layout',
    description: 'Container that preserves a width-to-height ratio.',
    exportName: 'AspectRatio',
    size: [320, 180],
    accepts: ['*'],
    props: { ratio: numberProp('Width divided by height.', 1.7778) },
  },
  {
    directory: 'avatar',
    id: 'Avatar',
    category: 'data-display',
    description: 'Profile image with fallback and status affordances.',
    exportName: 'Avatar',
    size: [40, 40],
    content: 'CN',
    parts: ['AvatarImage', 'AvatarFallback', 'AvatarBadge', 'AvatarGroup', 'AvatarGroupCount'],
    composition: [
      { key: 'fallback', exportName: 'AvatarFallback', content: 'CN' },
      { key: 'badge', exportName: 'AvatarBadge' },
    ],
    props: {},
  },
  {
    directory: 'badge',
    id: 'Badge',
    category: 'data-display',
    description: 'Compact status or category label.',
    exportName: 'Badge',
    size: [72, 24],
    content: 'Badge',
    props: {
      variant: enumProp(
        'Visual emphasis.',
        ['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'],
        'default',
      ),
    },
  },
  {
    directory: 'breadcrumb',
    id: 'Breadcrumb',
    category: 'navigation',
    description: 'Hierarchical location trail.',
    exportName: 'Breadcrumb',
    size: [360, 32],
    parts: [
      'BreadcrumbList',
      'BreadcrumbItem',
      'BreadcrumbLink',
      'BreadcrumbSeparator',
      'BreadcrumbPage',
      'BreadcrumbEllipsis',
    ],
    props: {},
  },
  {
    directory: 'button',
    id: 'Button',
    category: 'actions',
    description: 'Primary user action.',
    exportName: 'Button',
    size: [96, 32],
    content: 'Button',
    props: {
      variant: enumProp(
        'Visual emphasis.',
        ['default', 'primary', 'outline', 'secondary', 'ghost', 'destructive', 'link'],
        'default',
      ),
      size: enumProp(
        'Control size.',
        ['default', 'small', 'medium', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'],
        'default',
      ),
      disabled,
    },
    codegen: {
      propValueAliases: {
        variant: { primary: 'default' },
        size: { small: 'sm', medium: 'default' },
      },
    },
  },
  {
    directory: 'button-group',
    id: 'ButtonGroup',
    category: 'actions',
    description: 'Related actions presented as one control group.',
    exportName: 'ButtonGroup',
    size: [224, 32],
    parts: ['ButtonGroupText', 'ButtonGroupSeparator'],
    accepts: ['Button'],
    props: { orientation },
  },
  {
    directory: 'calendar',
    id: 'Calendar',
    category: 'forms',
    description: 'Single-date calendar picker.',
    exportName: 'Calendar',
    size: [280, 288],
    parts: [
      'Day',
      'Cell',
      'Grid',
      'Header',
      'Months',
      'GridRow',
      'Heading',
      'GridBody',
      'GridHead',
      'HeadCell',
      'NextButton',
      'PrevButton',
      'Nav',
      'Month',
      'YearSelect',
      'MonthSelect',
      'Caption',
    ],
    props: { disabled },
    interactive: true,
  },
  {
    directory: 'card',
    id: 'Card',
    category: 'layout',
    description: 'Grouped content and actions on a bounded surface.',
    exportName: 'Card',
    size: [360, 240],
    content: 'Card',
    parts: [
      'CardHeader',
      'CardTitle',
      'CardDescription',
      'CardAction',
      'CardContent',
      'CardFooter',
    ],
    composition: [
      { key: 'header', exportName: 'CardHeader' },
      { key: 'title', exportName: 'CardTitle', parentKey: 'header', content: 'Card title' },
      {
        key: 'description',
        exportName: 'CardDescription',
        parentKey: 'header',
        content: 'Supporting detail',
      },
      { key: 'action', exportName: 'CardAction', parentKey: 'header', content: 'Action' },
      { key: 'content', exportName: 'CardContent', content: 'Card content' },
      { key: 'footer', exportName: 'CardFooter', content: 'Card footer' },
    ],
    props: {
      density: enumProp(
        'Codesign layout density override.',
        ['compact', 'comfortable'],
        'comfortable',
      ),
      radius: enumProp('Codesign corner-radius token.', ['small', 'medium'], 'medium'),
    },
    codegen: { omitProps: ['density', 'radius'] },
  },
  {
    directory: 'carousel',
    id: 'Carousel',
    category: 'data-display',
    description: 'Horizontally or vertically browsable content.',
    exportName: 'Carousel',
    size: [420, 240],
    parts: ['CarouselContent', 'CarouselItem', 'CarouselPrevious', 'CarouselNext'],
    props: { orientation },
    interactive: true,
  },
  {
    directory: 'chart',
    id: 'Chart',
    category: 'data-display',
    description: 'Token-aware chart container and tooltip.',
    exportName: 'ChartContainer',
    size: [480, 280],
    parts: ['ChartTooltip'],
    props: {},
  },
  {
    directory: 'checkbox',
    id: 'Checkbox',
    category: 'forms',
    description: 'Boolean or indeterminate selection control.',
    exportName: 'Checkbox',
    size: [20, 20],
    props: {
      checked: booleanProp('Selected state.'),
      indeterminate: booleanProp('Mixed state.'),
      disabled,
    },
    interactive: true,
  },
  {
    directory: 'collapsible',
    id: 'Collapsible',
    category: 'layout',
    description: 'Expandable content region.',
    exportName: 'Collapsible',
    size: [320, 120],
    parts: ['CollapsibleTrigger', 'CollapsibleContent'],
    props: { open, disabled },
    interactive: true,
  },
  {
    directory: 'command',
    id: 'Command',
    category: 'navigation',
    description: 'Searchable command palette or action list.',
    exportName: 'Command',
    size: [420, 320],
    parts: [
      'CommandInput',
      'CommandList',
      'CommandGroup',
      'CommandItem',
      'CommandLinkItem',
      'CommandEmpty',
      'CommandSeparator',
      'CommandShortcut',
      'CommandLoading',
      'CommandDialog',
    ],
    props: { value },
    interactive: true,
  },
  {
    directory: 'context-menu',
    id: 'ContextMenu',
    category: 'overlays',
    description: 'Pointer-context action menu.',
    exportName: 'ContextMenu',
    size: [220, 240],
    parts: [
      'ContextMenuTrigger',
      'ContextMenuContent',
      'ContextMenuGroup',
      'ContextMenuGroupHeading',
      'ContextMenuLabel',
      'ContextMenuItem',
      'ContextMenuShortcut',
      'ContextMenuSeparator',
      'ContextMenuCheckboxItem',
      'ContextMenuRadioGroup',
      'ContextMenuRadioItem',
      'ContextMenuSub',
      'ContextMenuSubTrigger',
      'ContextMenuSubContent',
    ],
    props: { open },
    interactive: true,
  },
  {
    directory: 'data-table',
    id: 'DataTable',
    category: 'data-display',
    description: 'Headless table renderer for structured records.',
    exportName: 'FlexRender',
    size: [640, 320],
    props: {},
    renderStrategy: 'fallback',
  },
  {
    directory: 'dialog',
    id: 'Dialog',
    category: 'overlays',
    description: 'Modal content surface.',
    exportName: 'Dialog',
    size: [440, 280],
    content: 'Dialog title',
    parts: [
      'DialogTrigger',
      'DialogContent',
      'DialogHeader',
      'DialogTitle',
      'DialogDescription',
      'DialogFooter',
      'DialogClose',
    ],
    composition: [
      { key: 'trigger', exportName: 'DialogTrigger', content: 'Open dialog' },
      { key: 'content', exportName: 'DialogContent' },
      { key: 'header', exportName: 'DialogHeader', parentKey: 'content' },
      { key: 'title', exportName: 'DialogTitle', parentKey: 'header', content: 'Dialog title' },
      {
        key: 'description',
        exportName: 'DialogDescription',
        parentKey: 'header',
        content: 'Review the details before continuing.',
      },
      { key: 'footer', exportName: 'DialogFooter', parentKey: 'content' },
      { key: 'close', exportName: 'DialogClose', parentKey: 'footer', content: 'Close' },
    ],
    props: { open },
    interactive: true,
  },
  {
    directory: 'drawer',
    id: 'Drawer',
    category: 'overlays',
    description: 'Edge-attached modal drawer.',
    exportName: 'Drawer',
    size: [440, 320],
    parts: [
      'DrawerTrigger',
      'DrawerContent',
      'DrawerHeader',
      'DrawerTitle',
      'DrawerDescription',
      'DrawerFooter',
      'DrawerClose',
    ],
    props: {
      open,
      direction: enumProp('Opening edge.', ['top', 'right', 'bottom', 'left'], 'bottom'),
    },
    interactive: true,
  },
  {
    directory: 'dropdown-menu',
    id: 'DropdownMenu',
    category: 'overlays',
    description: 'Triggered menu of actions and choices.',
    exportName: 'DropdownMenu',
    size: [220, 260],
    parts: [
      'DropdownMenuTrigger',
      'DropdownMenuContent',
      'DropdownMenuGroup',
      'DropdownMenuGroupHeading',
      'DropdownMenuLabel',
      'DropdownMenuItem',
      'DropdownMenuShortcut',
      'DropdownMenuSeparator',
      'DropdownMenuCheckboxGroup',
      'DropdownMenuCheckboxItem',
      'DropdownMenuRadioGroup',
      'DropdownMenuRadioItem',
      'DropdownMenuSub',
      'DropdownMenuSubTrigger',
      'DropdownMenuSubContent',
    ],
    composition: [
      { key: 'trigger', exportName: 'DropdownMenuTrigger', content: 'Open menu' },
      { key: 'content', exportName: 'DropdownMenuContent' },
      { key: 'label', exportName: 'DropdownMenuLabel', parentKey: 'content', content: 'Actions' },
      { key: 'item', exportName: 'DropdownMenuItem', parentKey: 'content', content: 'Edit item' },
    ],
    props: { open },
    interactive: true,
  },
  {
    directory: 'empty',
    id: 'Empty',
    category: 'feedback',
    description: 'Empty state with guidance and an optional action.',
    exportName: 'Empty',
    size: [400, 240],
    content: 'Nothing here yet',
    parts: ['EmptyHeader', 'EmptyMedia', 'EmptyTitle', 'EmptyDescription', 'EmptyContent'],
    props: {},
  },
  {
    directory: 'field',
    id: 'Field',
    category: 'forms',
    description: 'Labeled form field composition.',
    exportName: 'Field',
    size: [320, 88],
    content: 'Field label',
    parts: [
      'FieldSet',
      'FieldLegend',
      'FieldGroup',
      'FieldContent',
      'FieldLabel',
      'FieldTitle',
      'FieldDescription',
      'FieldSeparator',
      'FieldError',
    ],
    props: { orientation },
  },
  {
    directory: 'form',
    id: 'Form',
    category: 'forms',
    description: 'Validated form composition powered by Formsnap.',
    exportName: 'FormField',
    size: [360, 220],
    parts: [
      'FormControl',
      'FormLabel',
      'FormButton',
      'FormFieldErrors',
      'FormDescription',
      'FormFieldset',
      'FormLegend',
      'FormElementField',
    ],
    props: {},
  },
  {
    directory: 'hover-card',
    id: 'HoverCard',
    category: 'overlays',
    description: 'Contextual preview revealed on hover.',
    exportName: 'HoverCard',
    size: [320, 180],
    parts: ['HoverCardTrigger', 'HoverCardContent'],
    props: { open },
    interactive: true,
  },
  {
    directory: 'input',
    id: 'Input',
    category: 'forms',
    description: 'Single-line text or data input.',
    exportName: 'Input',
    size: [240, 32],
    props: {
      type: enumProp(
        'Input semantics.',
        ['text', 'email', 'password', 'number', 'search', 'tel', 'url'],
        'text',
      ),
      value,
      placeholder: stringProp('Hint shown when empty.', 'Enter value'),
      disabled,
    },
    interactive: true,
  },
  {
    directory: 'input-group',
    id: 'InputGroup',
    category: 'forms',
    description: 'Input with related addons and actions.',
    exportName: 'InputGroup',
    size: [320, 36],
    parts: [
      'InputGroupAddon',
      'InputGroupButton',
      'InputGroupInput',
      'InputGroupText',
      'InputGroupTextarea',
    ],
    props: {},
  },
  {
    directory: 'input-otp',
    id: 'InputOTP',
    category: 'forms',
    description: 'Segmented one-time-password input.',
    exportName: 'InputOTP',
    size: [256, 40],
    parts: ['InputOTPGroup', 'InputOTPSlot', 'InputOTPSeparator'],
    props: { value, maxlength: numberProp('Maximum character count.', 6), disabled },
    interactive: true,
  },
  {
    directory: 'item',
    id: 'Item',
    category: 'data-display',
    description: 'Flexible media, content, and actions row.',
    exportName: 'Item',
    size: [400, 88],
    content: 'Item title',
    parts: [
      'ItemGroup',
      'ItemSeparator',
      'ItemHeader',
      'ItemFooter',
      'ItemContent',
      'ItemTitle',
      'ItemDescription',
      'ItemActions',
      'ItemMedia',
    ],
    props: {
      variant: enumProp('Surface treatment.', ['default', 'outline', 'muted'], 'default'),
      size: enumProp('Density.', ['default', 'sm'], 'default'),
    },
  },
  {
    directory: 'kbd',
    id: 'Kbd',
    category: 'data-display',
    description: 'Keyboard shortcut token.',
    exportName: 'Kbd',
    size: [48, 24],
    content: '⌘ K',
    parts: ['KbdGroup'],
    props: {},
  },
  {
    directory: 'label',
    id: 'Label',
    category: 'forms',
    description: 'Accessible label for a form control.',
    exportName: 'Label',
    size: [120, 24],
    content: 'Label',
    props: {},
  },
  {
    directory: 'menubar',
    id: 'Menubar',
    category: 'navigation',
    description: 'Desktop-style application menu bar.',
    exportName: 'Menubar',
    size: [400, 36],
    parts: [
      'MenubarMenu',
      'MenubarTrigger',
      'MenubarContent',
      'MenubarGroup',
      'MenubarGroupHeading',
      'MenubarLabel',
      'MenubarItem',
      'MenubarShortcut',
      'MenubarSeparator',
      'MenubarCheckboxItem',
      'MenubarRadioGroup',
      'MenubarRadioItem',
      'MenubarSub',
      'MenubarSubTrigger',
      'MenubarSubContent',
    ],
    props: {},
    interactive: true,
  },
  {
    directory: 'native-select',
    id: 'NativeSelect',
    category: 'forms',
    description: 'Browser-native option selector.',
    exportName: 'NativeSelect',
    size: [240, 32],
    parts: ['NativeSelectOption', 'NativeSelectOptGroup'],
    props: { value, size: enumProp('Control size.', ['default', 'sm'], 'default'), disabled },
    interactive: true,
  },
  {
    directory: 'navigation-menu',
    id: 'NavigationMenu',
    category: 'navigation',
    description: 'Structured site navigation with flyouts.',
    exportName: 'NavigationMenuRoot',
    size: [560, 200],
    parts: [
      'NavigationMenuList',
      'NavigationMenuItem',
      'NavigationMenuTrigger',
      'NavigationMenuContent',
      'NavigationMenuLink',
      'NavigationMenuIndicator',
      'NavigationMenuViewport',
    ],
    composition: [
      { key: 'list', exportName: 'NavigationMenuList' },
      { key: 'item', exportName: 'NavigationMenuItem', parentKey: 'list' },
      {
        key: 'trigger',
        exportName: 'NavigationMenuTrigger',
        parentKey: 'item',
        content: 'Products',
      },
      { key: 'content', exportName: 'NavigationMenuContent', parentKey: 'item' },
      {
        key: 'link',
        exportName: 'NavigationMenuLink',
        parentKey: 'content',
        content: 'Overview',
      },
    ],
    props: { orientation },
    interactive: true,
  },
  {
    directory: 'pagination',
    id: 'Pagination',
    category: 'navigation',
    description: 'Controls for moving through pages.',
    exportName: 'Pagination',
    size: [320, 36],
    parts: [
      'PaginationContent',
      'PaginationItem',
      'PaginationLink',
      'PaginationPrevious',
      'PaginationNext',
      'PaginationEllipsis',
    ],
    props: {
      count: numberProp('Total number of items.', 100),
      perPage: numberProp('Items per page.', 10),
    },
    interactive: true,
  },
  {
    directory: 'popover',
    id: 'Popover',
    category: 'overlays',
    description: 'Anchored contextual content.',
    exportName: 'Popover',
    size: [320, 180],
    parts: [
      'PopoverTrigger',
      'PopoverContent',
      'PopoverHeader',
      'PopoverTitle',
      'PopoverDescription',
      'PopoverClose',
    ],
    props: { open },
    interactive: true,
  },
  {
    directory: 'progress',
    id: 'Progress',
    category: 'feedback',
    description: 'Task completion indicator.',
    exportName: 'Progress',
    size: [320, 16],
    props: {
      value: numberProp('Completion from zero to maximum.', 50),
      max: numberProp('Maximum completion value.', 100),
    },
  },
  {
    directory: 'radio-group',
    id: 'RadioGroup',
    category: 'forms',
    description: 'Single-choice option group.',
    exportName: 'RadioGroup',
    size: [240, 104],
    parts: ['RadioGroupItem'],
    props: { value, orientation, disabled },
    interactive: true,
  },
  {
    directory: 'range-calendar',
    id: 'RangeCalendar',
    category: 'forms',
    description: 'Calendar for choosing a date interval.',
    exportName: 'RangeCalendar',
    size: [560, 288],
    parts: [
      'Day',
      'Cell',
      'Grid',
      'Header',
      'Months',
      'GridRow',
      'Heading',
      'GridBody',
      'GridHead',
      'HeadCell',
      'NextButton',
      'PrevButton',
      'MonthSelect',
      'YearSelect',
      'Caption',
      'Nav',
      'Month',
    ],
    props: { disabled },
    interactive: true,
  },
  {
    directory: 'resizable',
    id: 'Resizable',
    category: 'layout',
    description: 'User-resizable pane group.',
    exportName: 'ResizablePaneGroup',
    size: [560, 320],
    parts: ['ResizablePane', 'ResizableHandle'],
    props: {
      direction: enumProp('Pane split direction.', ['horizontal', 'vertical'], 'horizontal'),
    },
    interactive: true,
  },
  {
    directory: 'scroll-area',
    id: 'ScrollArea',
    category: 'layout',
    description: 'Custom scroll viewport.',
    exportName: 'ScrollArea',
    size: [320, 240],
    parts: ['ScrollAreaScrollbar'],
    props: { orientation },
    interactive: true,
  },
  {
    directory: 'select',
    id: 'Select',
    category: 'forms',
    description: 'Accessible single or multiple option selector.',
    exportName: 'Select',
    size: [240, 36],
    parts: [
      'SelectTrigger',
      'SelectContent',
      'SelectGroup',
      'SelectGroupHeading',
      'SelectLabel',
      'SelectItem',
      'SelectSeparator',
      'SelectScrollDownButton',
      'SelectScrollUpButton',
    ],
    composition: [
      { key: 'trigger', exportName: 'SelectTrigger', content: 'Choose an option' },
      { key: 'content', exportName: 'SelectContent' },
      { key: 'group', exportName: 'SelectGroup', parentKey: 'content' },
      {
        key: 'label',
        exportName: 'SelectLabel',
        parentKey: 'group',
        content: 'Options',
      },
      { key: 'item', exportName: 'SelectItem', parentKey: 'group', content: 'Option one' },
    ],
    props: {
      type: enumProp('Selection behavior.', ['single', 'multiple'], 'single'),
      value,
      disabled,
    },
    interactive: true,
  },
  {
    directory: 'separator',
    id: 'Separator',
    category: 'layout',
    description: 'Visual division between content regions.',
    exportName: 'Separator',
    size: [320, 1],
    props: { orientation },
  },
  {
    directory: 'sheet',
    id: 'Sheet',
    category: 'overlays',
    description: 'Side panel presented above the current view.',
    exportName: 'Sheet',
    size: [400, 640],
    parts: [
      'SheetTrigger',
      'SheetContent',
      'SheetHeader',
      'SheetTitle',
      'SheetDescription',
      'SheetFooter',
      'SheetClose',
    ],
    composition: [
      { key: 'trigger', exportName: 'SheetTrigger', content: 'Open sheet' },
      { key: 'content', exportName: 'SheetContent' },
      { key: 'header', exportName: 'SheetHeader', parentKey: 'content' },
      { key: 'title', exportName: 'SheetTitle', parentKey: 'header', content: 'Sheet title' },
      {
        key: 'description',
        exportName: 'SheetDescription',
        parentKey: 'header',
        content: 'Edit settings without leaving the canvas.',
      },
      { key: 'footer', exportName: 'SheetFooter', parentKey: 'content' },
      { key: 'close', exportName: 'SheetClose', parentKey: 'footer', content: 'Close' },
    ],
    props: { open, side: enumProp('Opening edge.', ['top', 'right', 'bottom', 'left'], 'right') },
    codegen: { omitProps: ['side'] },
    interactive: true,
  },
  {
    directory: 'sidebar',
    id: 'Sidebar',
    category: 'navigation',
    description: 'Responsive application sidebar composition.',
    exportName: 'Sidebar',
    size: [256, 640],
    parts: [
      'SidebarProvider',
      'SidebarHeader',
      'SidebarContent',
      'SidebarGroup',
      'SidebarGroupLabel',
      'SidebarGroupContent',
      'SidebarMenu',
      'SidebarMenuItem',
      'SidebarMenuButton',
      'SidebarMenuBadge',
      'SidebarMenuAction',
      'SidebarMenuSub',
      'SidebarMenuSubItem',
      'SidebarMenuSubButton',
      'SidebarFooter',
      'SidebarInput',
      'SidebarInset',
      'SidebarRail',
      'SidebarSeparator',
      'SidebarTrigger',
    ],
    props: {
      side: enumProp('Sidebar edge.', ['left', 'right'], 'left'),
      variant: enumProp('Surface treatment.', ['sidebar', 'floating', 'inset'], 'sidebar'),
      collapsible: enumProp(
        'Responsive collapse behavior.',
        ['offcanvas', 'icon', 'none'],
        'offcanvas',
      ),
    },
    interactive: true,
  },
  {
    directory: 'skeleton',
    id: 'Skeleton',
    category: 'feedback',
    description: 'Loading placeholder surface.',
    exportName: 'Skeleton',
    size: [240, 20],
    props: {},
  },
  {
    directory: 'slider',
    id: 'Slider',
    category: 'forms',
    description: 'Continuous or stepped numeric input.',
    exportName: 'Slider',
    size: [240, 24],
    props: {
      orientation,
      disabled,
      min: numberProp('Minimum value.', 0),
      max: numberProp('Maximum value.', 100),
      step: numberProp('Value increment.', 1),
    },
    interactive: true,
  },
  {
    directory: 'sonner',
    id: 'Sonner',
    displayName: 'Toast',
    category: 'feedback',
    description: 'Transient toast notification host.',
    exportName: 'Toaster',
    size: [360, 80],
    props: {
      position: enumProp(
        'Viewport placement.',
        ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'],
        'bottom-right',
      ),
    },
    interactive: true,
  },
  {
    directory: 'spinner',
    id: 'Spinner',
    category: 'feedback',
    description: 'Indeterminate loading indicator.',
    exportName: 'Spinner',
    size: [24, 24],
    props: {},
  },
  {
    directory: 'switch',
    id: 'Switch',
    category: 'forms',
    description: 'On or off setting control.',
    exportName: 'Switch',
    size: [32, 18],
    props: {
      checked: booleanProp('On state.'),
      size: enumProp('Control size.', ['default', 'sm'], 'default'),
      disabled,
    },
    interactive: true,
  },
  {
    directory: 'table',
    id: 'Table',
    category: 'data-display',
    description: 'Semantic rows and columns of data.',
    exportName: 'Table',
    size: [640, 280],
    parts: [
      'TableCaption',
      'TableHeader',
      'TableBody',
      'TableFooter',
      'TableRow',
      'TableHead',
      'TableCell',
    ],
    composition: [
      { key: 'caption', exportName: 'TableCaption', content: 'Table caption' },
      { key: 'header', exportName: 'TableHeader' },
      { key: 'header-row', exportName: 'TableRow', parentKey: 'header' },
      { key: 'head', exportName: 'TableHead', parentKey: 'header-row', content: 'Column' },
      { key: 'body', exportName: 'TableBody' },
      { key: 'body-row', exportName: 'TableRow', parentKey: 'body' },
      { key: 'cell', exportName: 'TableCell', parentKey: 'body-row', content: 'Value' },
      { key: 'footer', exportName: 'TableFooter', content: 'Summary' },
    ],
    props: {},
  },
  {
    directory: 'tabs',
    id: 'Tabs',
    category: 'navigation',
    description: 'Layered content selected from a tab list.',
    exportName: 'Tabs',
    size: [440, 240],
    parts: ['TabsList', 'TabsTrigger', 'TabsContent'],
    composition: [
      { key: 'list', exportName: 'TabsList' },
      { key: 'trigger', exportName: 'TabsTrigger', parentKey: 'list', content: 'Overview' },
      { key: 'content', exportName: 'TabsContent', content: 'Overview content' },
    ],
    props: { value: stringProp('Selected tab value.', 'overview'), orientation },
    interactive: true,
  },
  {
    directory: 'textarea',
    id: 'Textarea',
    category: 'forms',
    description: 'Multi-line text input.',
    exportName: 'Textarea',
    size: [320, 96],
    props: { value, placeholder: stringProp('Hint shown when empty.', 'Enter text'), disabled },
    interactive: true,
  },
  {
    directory: 'toggle',
    id: 'Toggle',
    category: 'actions',
    description: 'Two-state action button.',
    exportName: 'Toggle',
    size: [36, 32],
    content: 'Toggle',
    props: {
      pressed: booleanProp('Pressed state.'),
      variant: enumProp('Surface treatment.', ['default', 'outline'], 'default'),
      size: enumProp('Control size.', ['default', 'sm', 'lg'], 'default'),
      disabled,
    },
    interactive: true,
  },
  {
    directory: 'toggle-group',
    id: 'ToggleGroup',
    category: 'actions',
    description: 'Related single- or multi-select toggles.',
    exportName: 'ToggleGroup',
    size: [180, 36],
    parts: ['ToggleGroupItem'],
    props: {
      type: enumProp('Selection behavior.', ['single', 'multiple'], 'single'),
      orientation,
      disabled,
    },
    interactive: true,
  },
  {
    directory: 'tooltip',
    id: 'Tooltip',
    category: 'overlays',
    description: 'Short contextual label revealed on hover or focus.',
    exportName: 'Tooltip',
    size: [180, 48],
    content: 'Helpful detail',
    parts: ['TooltipProvider', 'TooltipTrigger', 'TooltipContent'],
    props: { open },
    interactive: true,
  },
] as const satisfies readonly ComponentSpec[];

function titleFromId(id: string) {
  return id.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function partId(rootId: string, exportName: string) {
  const suffix = exportName.startsWith(rootId) ? exportName.slice(rootId.length) : exportName;
  return `${rootId}.${suffix || exportName}`;
}

function isEditablePart(exportName: string) {
  return /(Title|Description|Label|Text|Shortcut|Caption|Head|Cell|Item|Link|Trigger|Action|Button|Error|Count)$/.test(
    exportName,
  );
}

function buildDefinition(spec: ComponentSpec): CodesignComponentDefinition {
  const importPath = `$lib/components/ui/${spec.directory}`;
  const partIds = (spec.parts ?? []).map((exportName) => partId(spec.id, exportName));
  const declaredComposition = spec.composition ?? [];
  const rootCompositionParts = declaredComposition
    .filter((item) => !item.parentKey)
    .map((item) => partId(spec.id, item.exportName));
  const slots: ComponentSlotDefinition[] = [
    {
      id: 'default',
      displayName: 'Content',
      accepts: [
        ...(declaredComposition.length ? rootCompositionParts : partIds),
        ...(spec.accepts ?? []),
      ],
    },
  ];
  const parts = (spec.parts ?? []).map((exportName) => {
    const parentKeys = declaredComposition
      .filter((item) => item.exportName === exportName)
      .map((item) => item.key);
    const declaredChildren = declaredComposition
      .filter((item) => item.parentKey && parentKeys.includes(item.parentKey))
      .map((item) => partId(spec.id, item.exportName));
    return {
      id: partId(spec.id, exportName),
      displayName: titleFromId(exportName),
      exportName,
      editableContent: isEditablePart(exportName),
      slots: declaredComposition.length
        ? declaredChildren.length
          ? [
              {
                id: 'default',
                displayName: 'Content',
                accepts: [...new Set(declaredChildren)],
              },
            ]
          : isEditablePart(exportName)
            ? []
            : [
                {
                  id: 'default',
                  displayName: 'Content',
                  accepts: ['*'],
                },
              ]
        : isEditablePart(exportName)
          ? []
          : [
              {
                id: 'default',
                displayName: 'Content',
                accepts: ['*'],
              },
            ],
    };
  });
  const defaultProps = Object.fromEntries(
    Object.entries(spec.props ?? {}).flatMap(([key, definition]) =>
      definition.default === undefined ? [] : [[key, definition.default]],
    ),
  );
  const editableContent = parts.length === 0 && spec.content !== undefined;
  const defaultComposition: ComponentBlueprintNode[] = [
    {
      key: 'root',
      componentId: spec.id,
      slot: 'default',
      content: editableContent ? spec.content : undefined,
      props: defaultProps,
    },
    ...(declaredComposition.length
      ? declaredComposition.map((item) => {
          const part = parts.find((candidate) => candidate.exportName === item.exportName)!;
          return {
            key: item.key,
            componentId: part.id,
            parentKey: item.parentKey ?? 'root',
            slot: 'default',
            content: item.content ?? (part.editableContent ? part.displayName : undefined),
            props: {},
          };
        })
      : parts.map((part, index) => ({
          key: `part-${index + 1}`,
          componentId: part.id,
          parentKey: 'root',
          slot: 'default',
          content: part.editableContent ? part.displayName : undefined,
          props: {},
        }))),
  ];
  return {
    id: spec.id,
    directory: spec.directory,
    displayName: spec.displayName ?? titleFromId(spec.id),
    category: spec.category,
    description: spec.description,
    importPath,
    exportName: spec.exportName,
    defaultSize: { width: spec.size[0], height: spec.size[1] },
    defaultContent: spec.content ?? spec.displayName ?? titleFromId(spec.id),
    editableContent,
    props: spec.props ?? {},
    slots,
    parts,
    defaultComposition,
    renderStrategy:
      spec.renderStrategy ??
      (declaredComposition.length ? 'compound' : parts.length ? 'fallback' : 'native'),
    interaction: { edit: 'selection-only', preview: spec.interactive ? 'enabled' : 'static' },
    codegen: {
      importPath,
      exportName: spec.exportName,
      importStyle: parts.length ? 'namespace' : 'named',
      ...spec.codegen,
    },
    load: () => loadShadcnExport(spec.directory, spec.exportName),
  };
}

export const componentCatalog = specs.map(
  buildDefinition,
) as readonly CodesignComponentDefinition[];
export const componentManifest = Object.fromEntries(
  componentCatalog.map((component) => [component.id, component]),
) as Readonly<Record<string, CodesignComponentDefinition>>;
export const componentRootIds = componentCatalog.map(
  (component) => component.id,
) as readonly string[];
export const componentPartIds = componentCatalog.flatMap((component) =>
  component.parts.map((part) => part.id),
) as readonly string[];
export const componentIds = [...componentRootIds, ...componentPartIds] as readonly string[];
export const componentPropKeys = [
  ...new Set(componentCatalog.flatMap((component) => Object.keys(component.props))),
] as readonly string[];
// `z.enum` preserves the finite set in the JSON schema sent to Codex.
export const componentIdSchema = z.enum(componentIds as [string, ...string[]]);

/** Read-only migration adapters for component IDs written by document v2. */
export const legacyComponentAliases = {
  DataRow: {
    targetId: 'Table.Row',
    props: {
      density: enumProp('Legacy row density.', ['compact', 'comfortable'], 'comfortable'),
      interactive: booleanProp('Legacy interactive row state.', true),
    },
  },
  NavItem: {
    targetId: 'NavigationMenu.Item',
    props: { active: booleanProp('Legacy active navigation state.') },
  },
  Panel: {
    targetId: 'Sheet.Content',
    props: { side: enumProp('Legacy panel edge.', ['left', 'right'], 'right') },
  },
} as const;

/**
 * Transitional view for editor code that predates the manifest. New code should
 * consume `componentCatalog`/`componentManifest` so metadata is not duplicated.
 */
export const componentRegistry = Object.fromEntries([
  ...componentCatalog.map((component) => [
    component.id,
    {
      id: component.id,
      name: component.displayName,
      importPath: component.importPath,
      allowedProps: Object.fromEntries(
        Object.entries(component.props).map(([key, definition]) => [
          key,
          definition.options ?? (definition.default === undefined ? [] : [definition.default]),
        ]),
      ) as Record<string, readonly unknown[]>,
      slots: component.slots.map((slot) => slot.id),
    },
  ]),
  ...Object.entries(legacyComponentAliases).map(([id, alias]) => {
    const target = resolveComponent(alias.targetId);
    return [
      id,
      {
        id,
        name: titleFromId(id),
        importPath: target?.root.importPath ?? '$lib/design-system',
        allowedProps: Object.fromEntries(
          Object.entries(alias.props).map(([key, definition]) => [key, definition.options ?? []]),
        ) as Record<string, readonly unknown[]>,
        slots: [],
      },
    ];
  }),
]) as Record<
  string,
  {
    id: string;
    name: string;
    importPath: string;
    allowedProps: Record<string, readonly unknown[]>;
    slots: string[];
  }
>;

export type ResolvedComponent = {
  root: CodesignComponentDefinition;
  part?: ComponentPartDefinition;
  exportName: string;
};

export function resolveComponent(componentId: string): ResolvedComponent | undefined {
  const root = componentManifest[componentId];
  if (root) return { root, exportName: root.exportName };
  for (const definition of componentCatalog) {
    const part = definition.parts.find((candidate) => candidate.id === componentId);
    if (part) return { root: definition, part, exportName: part.exportName };
  }
  return undefined;
}

export async function loadComponent(componentId: string) {
  const resolved = resolveComponent(componentId);
  if (!resolved) throw new Error(`Unknown component: ${componentId}`);
  return loadShadcnExport(resolved.root.directory, resolved.exportName);
}

export function validateComponentBinding(componentId: string, props: Record<string, unknown>) {
  const legacy = legacyComponentAliases[componentId as keyof typeof legacyComponentAliases];
  const resolved = resolveComponent(componentId);
  if (!resolved && !legacy)
    return { ok: false as const, error: `Unknown component: ${componentId}` };
  const definitions: Readonly<Record<string, ComponentPropDefinition>> = legacy
    ? legacy.props
    : resolved?.part
      ? {}
      : (resolved?.root.props ?? {});
  for (const [key, propValue] of Object.entries(props)) {
    const definition = definitions[key];
    if (!definition)
      return { ok: false as const, error: `${componentId} does not allow prop ${key}` };
    if (definition.options && !definition.options.some((candidate) => candidate === propValue)) {
      return {
        ok: false as const,
        error: `${String(propValue)} is not valid for ${componentId}.${key}`,
      };
    }
    if (definition.kind === 'boolean' && typeof propValue !== 'boolean')
      return { ok: false as const, error: `${componentId}.${key} must be a boolean` };
    if (definition.kind === 'number' && typeof propValue !== 'number')
      return { ok: false as const, error: `${componentId}.${key} must be a number` };
    if (definition.kind === 'string' && typeof propValue !== 'string')
      return { ok: false as const, error: `${componentId}.${key} must be a string` };
  }
  const contract = resolved?.root ?? resolveComponent(legacy!.targetId)!.root;
  return { ok: true as const, contract, part: resolved?.part, legacyTargetId: legacy?.targetId };
}

/** Maps Codesign-facing semantic props onto the checked-in shadcn component API. */
export function adaptComponentProps(
  componentId: string,
  props: Record<string, unknown>,
  rootProps: Record<string, unknown> = props,
): Record<string, unknown> {
  const binding = validateComponentBinding(componentId, props);
  if (!binding.ok) return {};
  const resolved = resolveComponent(binding.legacyTargetId ?? componentId);
  if (!resolved) return { ...props };
  if (resolved.part) {
    const adapted = { ...props };
    // Required primitive values are renderer metadata, not duplicated editable state.
    if (componentId === 'Tabs.Trigger' || componentId === 'Tabs.Content') {
      adapted.value = 'overview';
    }
    if (componentId === 'Select.Item') {
      adapted.value = 'option-one';
      adapted.label = 'Option one';
    }
    if (componentId === 'Sheet.Content') adapted.side = rootProps.side ?? 'right';
    return adapted;
  }
  const adapted = { ...props };
  for (const key of resolved.root.codegen.omitProps ?? []) delete adapted[key];
  for (const [key, aliases] of Object.entries(resolved.root.codegen.propValueAliases ?? {})) {
    const value = props[key];
    if (typeof value === 'string' && aliases[value] !== undefined) adapted[key] = aliases[value];
  }
  if (resolved.root.id === 'Card') {
    if ('density' in props) adapted.size = props.density === 'compact' ? 'sm' : 'default';
    if ('radius' in props) adapted.class = props.radius === 'small' ? 'rounded-md' : 'rounded-xl';
  }
  return adapted;
}

export function validateComponentChild(
  parentComponentId: string,
  childComponentId: string,
  slotId = 'default',
) {
  const parent = resolveComponent(parentComponentId);
  const child = resolveComponent(childComponentId);
  if (!parent)
    return { ok: false as const, error: `Unknown parent component: ${parentComponentId}` };
  if (!child) return { ok: false as const, error: `Unknown child component: ${childComponentId}` };
  const slot = (parent.part?.slots ?? parent.root.slots).find(
    (candidate) => candidate.id === slotId,
  );
  if (!slot)
    return { ok: false as const, error: `${parentComponentId} does not expose slot ${slotId}` };
  if (!slot.accepts.includes('*') && !slot.accepts.includes(childComponentId)) {
    return {
      ok: false as const,
      error: `${childComponentId} is not allowed in ${parentComponentId}.${slotId}`,
    };
  }
  return { ok: true as const, slot, parent, child };
}

export function getDefaultComponentBlueprint(componentId: string) {
  const definition = componentManifest[componentId];
  if (!definition) return undefined;
  return structuredClone(definition.defaultComposition);
}

export const bindingSchema = z
  .object({
    componentId: componentIdSchema,
    props: z.record(z.string(), z.unknown()),
    slot: z.string().min(1).optional(),
  })
  .superRefine((binding, ctx) => {
    const result = validateComponentBinding(binding.componentId, binding.props);
    if (!result.ok) ctx.addIssue({ code: 'custom', message: result.error });
  });
