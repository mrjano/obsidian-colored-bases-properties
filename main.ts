import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { ColoredBasesPropertiesPluginSettings, DEFAULT_SETTINGS, ColoredBasesPropertiesSettingTab } from './settings';

export default class ColoredBasesPropertiesPlugin extends Plugin {
	settings: ColoredBasesPropertiesPluginSettings;
	private scrollTimer: number | null = null;
	private currentBasesView: any = null;
	private scrollEventRef: (() => void) | null = null;
	private contentElement: HTMLElement | null = null;
	private mutationObserver: MutationObserver | null = null;

	async onload() {
		await this.loadSettings();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ColoredBasesPropertiesSettingTab(this.app, this));

		// Create style element for the plugin
		this.createStyleElement();
		
		// Add existing color rules to style element
		Object.entries(this.settings.pillColors).forEach(([originalText, color]) => {
			if (color && (this.settings.pillEnabled[originalText] !== false)) { // Only add if color is set and enabled
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
					this.processProperties();
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
		const existingStyle = document.getElementById('colored-bases-properties-style');
		if (!existingStyle) {
			const styleEl = document.createElement('style');
			styleEl.id = 'colored-bases-properties-style';
			styleEl.type = 'text/css';
			
			// Base styles are now in styles.css, this element only handles dynamic color rules
			styleEl.textContent = '';
			
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
		const styleEl = document.getElementById('colored-bases-properties-style') as HTMLStyleElement;
		if (!styleEl) return;

		// Find the original text from sanitized content to check if enabled
		const originalText = Object.keys(this.settings.pillColors).find(key => {
			const sanitized = key.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F-]/g, '');
			return sanitized === sanitizedContent;
		});
		
		// Skip if this property is disabled
		if (originalText && this.settings.pillEnabled[originalText] === false) {
			return;
		}

		// Remove existing rule for this content if it exists
		const existingRuleIndex = Array.from(styleEl.sheet?.cssRules || []).findIndex(rule => 
			rule.cssText.includes(`data-sanitized-content="${sanitizedContent}"`));
		
		if (existingRuleIndex !== -1) {
			styleEl.sheet?.deleteRule(existingRuleIndex);
		}

		// Add new rules
		if (this.settings.colorListProperties) {
			styleEl.sheet?.insertRule(
				`.multi-select-pill[data-sanitized-content="${sanitizedContent}"] { background-color: ${color} !important; }`
			);
		}
		
		if (this.settings.colorFormulaProperties) {
			styleEl.sheet?.insertRule(
				`div.bases-td[data-property^="formula"] > div.bases-rendered-value[data-sanitized-content="${sanitizedContent}"]:not(:has(img)):not(:has(svg)) { background-color: ${color} !important; }`
			);
		}
	}

	removeColorRule(sanitizedContent: string) {
		const styleEl = document.getElementById('colored-bases-properties-style') as HTMLStyleElement;
		if (!styleEl?.sheet) return;

		// Remove all rules that match this sanitized content
		const rulesToRemove = [];
		for (let i = 0; i < styleEl.sheet.cssRules.length; i++) {
			if (styleEl.sheet.cssRules[i].cssText.includes(`data-sanitized-content="${sanitizedContent}"`)) {
				rulesToRemove.push(i);
			}
		}
		
		// Remove in reverse order to maintain indices
		rulesToRemove.reverse().forEach(index => styleEl.sheet?.deleteRule(index));
	}

	updateColorRule(originalText: string, newColor: string) {
		const sanitized = originalText.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F-]/g, '');
		this.addColorRule(sanitized, newColor);
	}

	clearAllColorRules() {
		const styleEl = document.getElementById('colored-bases-properties-style') as HTMLStyleElement;
		if (styleEl) {
			styleEl.textContent = '';
		}
		setTimeout(() => this.processProperties(), 10);
	}

	removeStyleElement() {
		document.getElementById('colored-bases-properties-style')?.remove();
	}

	processProperties() {
		let settingsChanged = false;
		
		// Process list properties
		if (this.settings.colorListProperties) {
			document.querySelectorAll('.multi-select-pill').forEach((element: Element) => {
				const div = element as HTMLDivElement;
				const contentElement = div.querySelector('.multi-select-pill-content') as HTMLElement;
				const textContent = contentElement?.textContent || div.textContent || '';
				
				if (textContent) {
					const sanitized = textContent.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F-]/g, '');
					div.setAttribute('data-sanitized-content', sanitized);
					
					if (!this.settings.pillColors.hasOwnProperty(textContent)) {
						const generatedColor = this.generateColorFromText(sanitized);
						this.settings.pillColors[textContent] = generatedColor;
						this.settings.pillEnabled[textContent] = true; // Enable by default
						settingsChanged = true;
						this.addColorRule(sanitized, generatedColor);
					} else if (this.settings.pillColors[textContent]) {
						// Ensure enabled state exists for existing properties
						if (!this.settings.pillEnabled.hasOwnProperty(textContent)) {
							this.settings.pillEnabled[textContent] = true;
							settingsChanged = true;
						}
						// Only add color rule if property is enabled
						if (this.settings.pillEnabled[textContent] !== false) {
							this.addColorRule(sanitized, this.settings.pillColors[textContent]);
						}
					}
				}
			});
		}
		
		// Process formula properties
		if (this.settings.colorFormulaProperties) {
			document.querySelectorAll('div.bases-td[data-property^="formula"] > div.bases-rendered-value').forEach((element: Element) => {
				const div = element as HTMLDivElement;
				
				// Skip if this element contains an image (check multiple ways for robustness)
				if (div.querySelector('img') || 
				    div.querySelector('svg') || 
				    div.innerHTML.includes('<img') || 
				    div.innerHTML.includes('<svg') ||
				    div.classList.contains('has-image')) {
					// Remove any existing data attribute to prevent coloring
					div.removeAttribute('data-sanitized-content');
					return;
				}
				
				const textContent = div.textContent?.trim() || '';
				
				// Also skip if no meaningful text content (might be image-only)
				if (!textContent || textContent.length === 0) {
					div.removeAttribute('data-sanitized-content');
					return;
				}
				
				const sanitized = textContent.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F-]/g, '');
				div.setAttribute('data-sanitized-content', sanitized);
				
				if (!this.settings.pillColors.hasOwnProperty(textContent)) {
					const generatedColor = this.generateColorFromText(sanitized);
					this.settings.pillColors[textContent] = generatedColor;
					this.settings.pillEnabled[textContent] = true; // Enable by default
					settingsChanged = true;
					this.addColorRule(sanitized, generatedColor);
				} else if (this.settings.pillColors[textContent]) {
					// Ensure enabled state exists for existing properties
					if (!this.settings.pillEnabled.hasOwnProperty(textContent)) {
						this.settings.pillEnabled[textContent] = true;
						settingsChanged = true;
					}
					// Only add color rule if property is enabled
					if (this.settings.pillEnabled[textContent] !== false) {
						this.addColorRule(sanitized, this.settings.pillColors[textContent]);
					}
				}
			});
		}
		
		if (settingsChanged) {
			this.saveSettings();
		}
	}

	setupViewportListener() {
		this.clearViewportListener();
		
		const targetElement = document.querySelector('.bases-view') || 
		                     document.querySelector('.workspace-leaf-content[data-type="file-properties"]') ||
		                     document.querySelector('.workspace-leaf.mod-active .workspace-leaf-content');
		
		if (targetElement) {
			this.contentElement = targetElement as HTMLElement;
			this.scrollEventRef = () => {
				if (this.scrollTimer) clearTimeout(this.scrollTimer);
				this.scrollTimer = window.setTimeout(() => this.processProperties(), 150);
			};
			
			this.registerDomEvent(this.contentElement, 'scroll', this.scrollEventRef);
			this.setupMutationObserver(this.contentElement);
		}
	}

	setupMutationObserver(targetElement: HTMLElement) {
		this.clearMutationObserver();
		
		this.mutationObserver = new MutationObserver((mutations) => {
			const shouldReprocess = mutations.some(mutation => 
				mutation.type === 'childList' && 
				Array.from(mutation.addedNodes).some((node: Node) => {
					if (node.nodeType !== Node.ELEMENT_NODE) return false;
					const element = node as Element;
					return element.classList?.contains('multi-select-pill') || 
					       element.querySelector?.('.multi-select-pill') ||
					       (element.classList?.contains('bases-rendered-value') && 
					        !element.querySelector('img') && 
					        !element.querySelector('svg') && 
					        !element.innerHTML.includes('<img') &&
					        !element.innerHTML.includes('<svg')) ||
					       element.querySelector?.('div.bases-td[data-property^="formula"] > div.bases-rendered-value');
				})
			);
			
			if (shouldReprocess) {
				// Add a small delay to ensure DOM has fully settled after mutations
				setTimeout(() => this.processProperties(), 50);
			}
		});
		
		this.mutationObserver.observe(targetElement, { childList: true, subtree: true });
	}

	clearMutationObserver() {
		if (this.mutationObserver) {
			this.mutationObserver.disconnect();
			this.mutationObserver = null;
		}
	}

	clearViewportListener() {
		if (this.scrollTimer) {
			clearTimeout(this.scrollTimer);
			this.scrollTimer = null;
		}
		
		if (this.contentElement && this.scrollEventRef) {
			this.contentElement.removeEventListener('scroll', this.scrollEventRef);
			this.scrollEventRef = null;
			this.contentElement = null;
		}
		
		this.clearMutationObserver();
	}
}
