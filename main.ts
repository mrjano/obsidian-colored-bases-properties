import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { ColoredPropertyListsPluginSettings, DEFAULT_SETTINGS, ColoredPropertyListsSettingTab } from './settings';

const BASE_PILL_STYLES = `
				/* Base styles for property list values */
				.multi-select-pill[data-sanitized-content] {
					transition: background-color 0.2s ease;
					color: white !important;
				}
			`;

export default class ColoredPropertyListsPlugin extends Plugin {
	settings: ColoredPropertyListsPluginSettings;
	private debounceTimer: number | null = null;
	private currentBasesView: any = null;
	private scrollEventRef: (() => void) | null = null;
	private contentElement: HTMLElement | null = null;
	private addedStyleRules: Set<string> = new Set();
	private mutationObserver: MutationObserver | null = null;

	async onload() {
		await this.loadSettings();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ColoredPropertyListsSettingTab(this.app, this));

		// Create style element for the plugin
		this.createStyleElement();
		
		// Add existing color rules to style element
		Object.entries(this.settings.pillColors).forEach(([originalText, color]) => {
			if (color) { // Only add if color is set
				const sanitized = originalText.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F-]/g, '');
				this.addColorRule(sanitized, color);
			}
		});

		// Register event to track when the current leaf changes
		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
			this.onLeafChange(leaf);
		}));

	}

	onunload() {
		// Remove the style element when plugin is unloaded
		this.removeStyleElement();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	onLeafChange(leaf: any) {
		if (leaf) {
			const view = leaf.view;
			
			// Check if this is a Bases file or file properties view
			if (view?.getViewType() === 'bases' || view?.getViewType() === 'file-properties') {
				this.currentBasesView = view;
				// Add a small delay to ensure DOM is fully rendered
				setTimeout(() => {
					this.processListProperties();
				}, 100);
				this.setupViewportListener();
			} else {
				// Clear current view if switching away
				this.currentBasesView = null;
				this.clearViewportListener();
			}
		}
	}

	createStyleElement() {
		// Check if style element already exists
		const existingStyle = document.getElementById('colored-property-lists-style');
		if (!existingStyle) {
			const styleEl = document.createElement('style');
			styleEl.id = 'colored-property-lists-style';
			styleEl.type = 'text/css';
			
			// Add base CSS rules for colored property lists
			styleEl.textContent = BASE_PILL_STYLES;
			
			document.head.appendChild(styleEl);
		}
	}

	generateColorFromText(text: string): string {
		// Generate a hash from the sanitized text
		let hash = 0;
		for (let i = 0; i < text.length; i++) {
			const char = text.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		
		// Use hash to generate HSL values
		const hue = Math.abs(hash) % 360;
		// Medium saturation for balanced pastel colors
		const saturation = 45 + (Math.abs(hash >> 8) % 20); // 45-65%
		// Medium lightness for readable but not too bright colors
		const lightness = 35 + (Math.abs(hash >> 16) % 15); // 35-50%
		
		return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
	}

	addColorRule(sanitizedContent: string, color: string) {
		const styleEl = document.getElementById('colored-property-lists-style');
		if (styleEl) {
			// Check if we've already added this rule
			if (this.addedStyleRules.has(sanitizedContent)) {
				// If rule exists, update it by removing and re-adding
				this.removeColorRule(sanitizedContent);
			}
			
			// Add the new color rule for both Bases view and file properties
			const newRule = `
				.multi-select-pill[data-sanitized-content="${sanitizedContent}"] {
					background-color: ${color} !important;
				}`;
			
			styleEl.textContent += newRule;
			this.addedStyleRules.add(sanitizedContent);
		}
	}

	removeColorRule(sanitizedContent: string) {
		const styleEl = document.getElementById('colored-property-lists-style');
		if (styleEl && this.addedStyleRules.has(sanitizedContent)) {
			// Rebuild the entire style content without this rule
			let newContent = BASE_PILL_STYLES;
			this.addedStyleRules.delete(sanitizedContent);
			
			// Re-add all other rules
			Object.entries(this.settings.pillColors).forEach(([originalText, color]) => {
				if (color) {
					const sanitized = originalText.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F-]/g, '');
					if (sanitized !== sanitizedContent) { // Skip the one we're removing
						newContent += `
				.multi-select-pill[data-sanitized-content="${sanitized}"] {
					background-color: ${color} !important;
				}`;
					}
				}
			});
			
			styleEl.textContent = newContent;
		}
	}

	updateColorRule(originalText: string, newColor: string) {
		const sanitized = originalText.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F-]/g, '');
		this.addColorRule(sanitized, newColor);
	}

	clearAllColorRules() {
		// Clear all style rules
		this.addedStyleRules.clear();
		// Reset the style element to only base styles
		const styleEl = document.getElementById('colored-property-lists-style');
		if (styleEl) {
			styleEl.textContent = BASE_PILL_STYLES;
		}
		
		// Remove data attributes from all existing pills so they can be reprocessed
		const pillElements = document.querySelectorAll('.multi-select-pill[data-sanitized-content]');
		pillElements.forEach((element: Element) => {
			element.removeAttribute('data-sanitized-content');
		});
	}

	removeStyleElement() {
		const styleEl = document.getElementById('colored-property-lists-style');
		if (styleEl) {
			styleEl.remove();
		}
	}

	analyzeBasesContent() {
		// Clear any existing debounce timer
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		// Debounce the analysis (only for scroll events)
		this.debounceTimer = window.setTimeout(() => {
			this.processListProperties();
		}, 100);
	}

	processListProperties() {
		// Find all multi-select pill content elements in both Bases view and file properties
		const pillElements = document.querySelectorAll('.multi-select-pill');
		let settingsChanged = false;
		
		pillElements.forEach((element: Element) => {
			const div = element as HTMLDivElement;
			// For file properties, the text is in .multi-select-pill-content
			const contentElement = div.querySelector('.multi-select-pill-content') as HTMLElement;
			const textContent = contentElement ? contentElement.textContent || '' : div.textContent || '';
			
			// Only process if not already processed and has content
			if (textContent && !div.hasAttribute('data-sanitized-content')) {
				// Sanitize text content for CSS selector (remove spaces but keep accents and alphanumeric)
				const sanitized = textContent.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F-]/g, '');
				
				// Add data attribute with sanitized version
				div.setAttribute('data-sanitized-content', sanitized);
				
				// Store original text as key in settings (no sanitization needed for object keys)
				if (!this.settings.pillColors.hasOwnProperty(textContent)) {
					// Generate a color based on the sanitized content
					const generatedColor = this.generateColorFromText(sanitized);
					this.settings.pillColors[textContent] = generatedColor;
					settingsChanged = true;
					
					// Add the color rule to the style element
					this.addColorRule(sanitized, generatedColor);
				} else if (this.settings.pillColors[textContent] && !this.addedStyleRules.has(sanitized)) {
					// If color exists but rule not added yet, add it
					this.addColorRule(sanitized, this.settings.pillColors[textContent]);
				}
			}
		});
		
		// Save settings if new pills were detected
		if (settingsChanged) {
			this.saveSettings();
		}
	}

	setupViewportListener() {
		// Clear any existing listener first
		this.clearViewportListener();
		
		// Find the actual view container for scrolling
		const basesViewEl = document.querySelector('.bases-view') as HTMLElement;
		const filePropsViewEl = document.querySelector('.workspace-leaf-content[data-type="file-properties"]') as HTMLElement;
		
		let targetElement = basesViewEl || filePropsViewEl;
		
		if (targetElement) {
			this.contentElement = targetElement;
			this.scrollEventRef = () => {
				this.analyzeBasesContent(); // This will be debounced
			};
			this.registerDomEvent(targetElement, 'scroll', this.scrollEventRef);
			
			// Setup mutation observer to detect when pills are recreated after editing
			this.setupMutationObserver(targetElement);
		} else {
			// Fallback to the active leaf content
			const contentEl = document.querySelector('.workspace-leaf.mod-active .workspace-leaf-content') as HTMLElement;
			if (contentEl) {
				this.contentElement = contentEl;
				this.scrollEventRef = () => {
					this.analyzeBasesContent(); // This will be debounced
				};
				this.registerDomEvent(contentEl, 'scroll', this.scrollEventRef);
				
				// Setup mutation observer
				this.setupMutationObserver(contentEl);
			}
		}
	}

	setupMutationObserver(targetElement: HTMLElement) {
		// Clear any existing observer
		this.clearMutationObserver();
		
		this.mutationObserver = new MutationObserver((mutations) => {
			let shouldReprocess = false;
			
			mutations.forEach((mutation) => {
				// Check if pills were added or modified
				if (mutation.type === 'childList') {
					// Check if any added nodes contain multi-select pills
					mutation.addedNodes.forEach((node) => {
						if (node.nodeType === Node.ELEMENT_NODE) {
							const element = node as Element;
							if (element.classList?.contains('multi-select-pill') || 
								element.querySelector?.('.multi-select-pill')) {
								shouldReprocess = true;
							}
						}
					});
				}
			});
			
			if (shouldReprocess) {
				// Debounce the reprocessing to avoid too many calls during editing
				if (this.debounceTimer) {
					clearTimeout(this.debounceTimer);
				}
				this.debounceTimer = window.setTimeout(() => {
					this.processListProperties();
				}, 200);
			}
		});
		
		// Observe changes to the Bases view container
		this.mutationObserver.observe(targetElement, {
			childList: true,
			subtree: true
		});
	}

	clearMutationObserver() {
		if (this.mutationObserver) {
			this.mutationObserver.disconnect();
			this.mutationObserver = null;
		}
	}

	clearViewportListener() {
		// Clear the debounce timer when switching away from Bases view
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		
		// Remove the scroll event listener manually
		if (this.contentElement && this.scrollEventRef) {
			this.contentElement.removeEventListener('scroll', this.scrollEventRef);
			this.scrollEventRef = null;
			this.contentElement = null;
		}
		
		// Clear the mutation observer
		this.clearMutationObserver();
	}
}
