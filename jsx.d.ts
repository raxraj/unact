/**
 * jsx.d.ts – TypeScript JSX namespace for Unact
 *
 * Enables type-safe JSX in *.tsx files when the compiler is configured with:
 *   "jsxFactory": "h"
 *   "jsxFragmentFactory": "Fragment"
 */

import { Child, ComponentFn } from "./dom";

// Allow the JSX factory to accept component functions as tags.
declare global {
  namespace JSX {
    /** The type every JSX expression evaluates to. */
    type Element = Node;

    /** Allows function components: `(props: Props) => Node`. */
    interface ElementClass {
      render(): Node;
    }

    /** Shared HTML attribute shape (covers the most-used attributes). */
    interface HTMLAttributes {
      // Core
      id?: string;
      class?: string | (() => string);
      className?: string | (() => string);
      style?: string | Partial<CSSStyleDeclaration> | (() => string | Partial<CSSStyleDeclaration>);
      title?: string;
      hidden?: boolean | (() => boolean);
      tabIndex?: number;

      // Aria
      role?: string;
      "aria-label"?: string;
      "aria-hidden"?: boolean | (() => boolean);
      "aria-live"?: "polite" | "assertive" | "off";

      // Data attributes (loose)
      [dataAttr: `data-${string}`]: string | number | boolean | undefined;

      // ref callback
      ref?: (el: HTMLElement) => void;

      // Lifecycle / reactive escape hatch
      children?: Child | Child[];
    }

    /** Event handler attributes shared by all elements. */
    interface DOMEventHandlers {
      onClick?: (e: MouseEvent) => void;
      onDblClick?: (e: MouseEvent) => void;
      onMouseEnter?: (e: MouseEvent) => void;
      onMouseLeave?: (e: MouseEvent) => void;
      onMouseDown?: (e: MouseEvent) => void;
      onMouseUp?: (e: MouseEvent) => void;
      onKeyDown?: (e: KeyboardEvent) => void;
      onKeyUp?: (e: KeyboardEvent) => void;
      onFocus?: (e: FocusEvent) => void;
      onBlur?: (e: FocusEvent) => void;
      onChange?: (e: Event) => void;
      onInput?: (e: InputEvent) => void;
      onSubmit?: (e: SubmitEvent) => void;
      onScroll?: (e: Event) => void;
    }

    /** Combined attributes for most HTML elements. */
    type CommonHTMLProps = HTMLAttributes & DOMEventHandlers;

    /** Input-specific attributes. */
    interface InputProps extends CommonHTMLProps {
      type?: string;
      value?: string | number | (() => string | number);
      placeholder?: string;
      disabled?: boolean | (() => boolean);
      readOnly?: boolean;
      checked?: boolean | (() => boolean);
      min?: number | string;
      max?: number | string;
      step?: number | string;
      name?: string;
      autoFocus?: boolean;
      autocomplete?: string;
    }

    /** Textarea-specific attributes. */
    interface TextareaProps extends CommonHTMLProps {
      value?: string | (() => string);
      placeholder?: string;
      disabled?: boolean | (() => boolean);
      rows?: number;
      cols?: number;
      name?: string;
    }

    /** Select-specific attributes. */
    interface SelectProps extends CommonHTMLProps {
      value?: string | (() => string);
      disabled?: boolean | (() => boolean);
      multiple?: boolean;
      name?: string;
    }

    /** Anchor-specific attributes. */
    interface AnchorProps extends CommonHTMLProps {
      href?: string;
      target?: string;
      rel?: string;
      download?: string | boolean;
    }

    /** Image-specific attributes. */
    interface ImageProps extends CommonHTMLProps {
      src?: string | (() => string);
      alt?: string | (() => string);
      width?: number | string;
      height?: number | string;
      loading?: "eager" | "lazy";
    }

    /** Button-specific attributes. */
    interface ButtonProps extends CommonHTMLProps {
      type?: "button" | "submit" | "reset";
      disabled?: boolean | (() => boolean);
      name?: string;
      value?: string;
    }

    /** Form-specific attributes. */
    interface FormProps extends CommonHTMLProps {
      action?: string;
      method?: "get" | "post";
      encType?: string;
    }

    /** Script-specific attributes. */
    interface ScriptProps extends CommonHTMLProps {
      src?: string;
      type?: string;
      async?: boolean;
      defer?: boolean;
    }

    /**
     * Intrinsic (native HTML) element map.
     * Each key is an HTML tag name; the value is the allowed prop shape.
     * Add more entries as needed — the compiler accepts any key not listed here
     * via the index signature at the end.
     */
    interface IntrinsicElements {
      // Document structure
      html: CommonHTMLProps;
      head: CommonHTMLProps;
      body: CommonHTMLProps;
      main: CommonHTMLProps;
      header: CommonHTMLProps;
      footer: CommonHTMLProps;
      nav: CommonHTMLProps;
      aside: CommonHTMLProps;
      section: CommonHTMLProps;
      article: CommonHTMLProps;

      // Headings & text
      h1: CommonHTMLProps;
      h2: CommonHTMLProps;
      h3: CommonHTMLProps;
      h4: CommonHTMLProps;
      h5: CommonHTMLProps;
      h6: CommonHTMLProps;
      p: CommonHTMLProps;
      span: CommonHTMLProps;
      strong: CommonHTMLProps;
      em: CommonHTMLProps;
      small: CommonHTMLProps;
      label: CommonHTMLProps & { for?: string; htmlFor?: string };
      abbr: CommonHTMLProps;
      blockquote: CommonHTMLProps;
      pre: CommonHTMLProps;
      code: CommonHTMLProps;

      // Containers & layout
      div: CommonHTMLProps;
      figure: CommonHTMLProps;
      figcaption: CommonHTMLProps;
      details: CommonHTMLProps;
      summary: CommonHTMLProps;

      // Interactive
      a: AnchorProps;
      button: ButtonProps;
      input: InputProps;
      textarea: TextareaProps;
      select: SelectProps;
      option: CommonHTMLProps & { value?: string; selected?: boolean };
      form: FormProps;

      // Media
      img: ImageProps;
      video: CommonHTMLProps & { src?: string; autoPlay?: boolean; controls?: boolean; loop?: boolean; muted?: boolean };
      audio: CommonHTMLProps & { src?: string; autoPlay?: boolean; controls?: boolean; loop?: boolean; muted?: boolean };
      canvas: CommonHTMLProps & { width?: number; height?: number };
      svg: CommonHTMLProps & { viewBox?: string; xmlns?: string; width?: number | string; height?: number | string };
      path: CommonHTMLProps & { d?: string; fill?: string; stroke?: string; "stroke-width"?: number | string };
      circle: CommonHTMLProps & { cx?: number; cy?: number; r?: number; fill?: string };

      // Lists
      ul: CommonHTMLProps;
      ol: CommonHTMLProps;
      li: CommonHTMLProps;
      dl: CommonHTMLProps;
      dt: CommonHTMLProps;
      dd: CommonHTMLProps;

      // Table
      table: CommonHTMLProps;
      thead: CommonHTMLProps;
      tbody: CommonHTMLProps;
      tfoot: CommonHTMLProps;
      tr: CommonHTMLProps;
      th: CommonHTMLProps & { colSpan?: number; rowSpan?: number; scope?: string };
      td: CommonHTMLProps & { colSpan?: number; rowSpan?: number };

      // Meta / embeds
      script: ScriptProps;
      link: CommonHTMLProps & { rel?: string; href?: string; type?: string };
      meta: CommonHTMLProps & { name?: string; content?: string; charset?: string };
      style: CommonHTMLProps;
      template: CommonHTMLProps;
      slot: CommonHTMLProps;
      iframe: CommonHTMLProps & { src?: string; allowFullScreen?: boolean; sandbox?: string };

      // Misc
      hr: CommonHTMLProps;
      br: CommonHTMLProps;

      // Catch-all for any tag not listed above.
      [tag: string]: CommonHTMLProps;
    }
  }
}

export {};
