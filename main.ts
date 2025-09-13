import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { ColoredBasesPropertiesPluginSettings, DEFAULT_SETTINGS, ColoredBasesPropertiesSettingTab } from './settings';

export default class ColoredBasesPropertiesPlugin extends Plugin {
	settings: ColoredBasesPropertiesPluginSettings;
	private scrollTimer: number | null = null;
	private editorChangeTimer: number | null = null; // Separate timer for editor changes
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
				const sanitized = originalText.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F+\-]/g, '');
				this.addColorRule(sanitized, color);
			}
		});

		// Register event to track when the current leaf changes
		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
			this.onLeafChange(leaf);
		}));

		// Register event to track editor changes for inline tags with debouncing
		this.registerEvent(this.app.workspace.on('editor-change', (editor, info) => {
			// Only process if inline tags are enabled and we're in a markdown view
			if (this.settings.colorInlineTags && 
			    this.app.workspace.activeLeaf?.view?.getViewType() === 'markdown') {
				// Use a separate timer for editor changes to avoid conflicts with scroll timer
				if (this.editorChangeTimer) clearTimeout(this.editorChangeTimer);
				this.editorChangeTimer = window.setTimeout(() => this.processProperties(), 500);
			}
		}));

	}

	onunload() {
		// Clear all timers and listeners
		this.clearViewportListener();
		
		// Clear editor change timer
		if (this.editorChangeTimer) {
			clearTimeout(this.editorChangeTimer);
			this.editorChangeTimer = null;
		}
		
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
			
			// Check if this is a Bases file, file properties view, or markdown view (which might contain embedded bases)
			if (view?.getViewType() === 'bases' || 
			    view?.getViewType() === 'file-properties' || 
			    view?.getViewType() === 'markdown') {
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

	addColorRule(sanitizedContent: string, color: string, isInlineTag: boolean = false) {
		const styleEl = document.getElementById('colored-bases-properties-style') as HTMLStyleElement;
		if (!styleEl) return;

		// Find the original text from sanitized content to check if enabled
		const originalText = Object.keys(this.settings.pillColors).find(key => {
			const sanitized = key.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F+\-]/g, '');
			return sanitized === sanitizedContent;
		});
		
		// Skip if this property is disabled
		if (originalText && this.settings.pillEnabled[originalText] === false) {
			return;
		}

		// Remove existing rules for this content
		const rulesToRemove = [];
		for (let i = 0; i < (styleEl.sheet?.cssRules.length || 0); i++) {
			const rule = styleEl.sheet!.cssRules[i];
			if (rule.cssText.includes(`data-sanitized-content="${sanitizedContent}"`) ||
			    (isInlineTag && rule.cssText.includes(`cm-tag-${sanitizedContent}`))) {
				rulesToRemove.push(i);
			}
		}
		
		// Remove in reverse order to maintain indices
		rulesToRemove.reverse().forEach(index => styleEl.sheet?.deleteRule(index));

		// Handle inline tags differently
		if (isInlineTag) {
			if (this.settings.colorInlineTags) {
				styleEl.sheet?.insertRule(
					`span.cm-tag-${sanitizedContent} { background-color: ${color} !important; }`
				);
			}
			return;
		}

		// Add new rules for regular properties
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

		// Add new rules for embedded bases (only if embedded bases setting is enabled and the respective property type is also enabled)
		if (this.settings.colorEmbeddedBases) {
			if (this.settings.colorListProperties) {
				styleEl.sheet?.insertRule(
					`.internal-embed.bases-embed .multi-select-pill[data-sanitized-content="${sanitizedContent}"] { background-color: ${color} !important; }`
				);
			}
			
			if (this.settings.colorFormulaProperties) {
				styleEl.sheet?.insertRule(
					`.internal-embed.bases-embed div.bases-td[data-property^="formula"] > div.bases-rendered-value[data-sanitized-content="${sanitizedContent}"]:not(:has(img)):not(:has(svg)) { background-color: ${color} !important; }`
				);
			}
		}
	}

	removeColorRule(sanitizedContent: string) {
		const styleEl = document.getElementById('colored-bases-properties-style') as HTMLStyleElement;
		if (!styleEl?.sheet) return;

		// Remove all rules that match this sanitized content (both data attributes and inline tags)
		const rulesToRemove = [];
		for (let i = 0; i < styleEl.sheet.cssRules.length; i++) {
			const rule = styleEl.sheet.cssRules[i];
			if (rule.cssText.includes(`data-sanitized-content="${sanitizedContent}"`) ||
			    rule.cssText.includes(`cm-tag-${sanitizedContent}`)) {
				rulesToRemove.push(i);
			}
		}
		
		// Remove in reverse order to maintain indices
		rulesToRemove.reverse().forEach(index => styleEl.sheet?.deleteRule(index));
	}

	updateColorRule(originalText: string, newColor: string) {
		const sanitized = originalText.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F+\-]/g, '');
		// First remove any existing rules for this content
		this.removeColorRule(sanitized);
		// Then add the new rule
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
		
		// Define property type configurations
		const propertyTypes = [
			{
				enabled: this.settings.colorListProperties,
				selector: '.multi-select-pill',
				getTextContent: (element: HTMLDivElement) => {
					const contentElement = element.querySelector('.multi-select-pill-content') as HTMLElement;
					return contentElement?.textContent || element.textContent || '';
				},
				shouldSkip: () => false,
			},
			{
				enabled: this.settings.colorFormulaProperties,
				selector: 'div.bases-td[data-property^="formula"] > div.bases-rendered-value',
				getTextContent: (element: HTMLDivElement) => element.textContent?.trim() || '',
				shouldSkip: (element: HTMLDivElement) => {
					// Skip if this element contains an image (check multiple ways for robustness)
					if (element.querySelector('img') || 
					    element.querySelector('svg') || 
					    element.innerHTML.includes('<img') || 
					    element.innerHTML.includes('<svg') ||
					    element.classList.contains('has-image')) {
						// Remove any existing data attribute to prevent coloring
						element.removeAttribute('data-sanitized-content');
						return true;
					}
					return false;
				},
			},
			{
				enabled: this.settings.colorInlineTags,
				selector: 'span[class*="cm-tag-"]',
				getTextContent: (element: HTMLDivElement) => {
					// Extract tag name from class (e.g., cm-tag-mytag -> mytag)
					const className = Array.from(element.classList).find(cls => cls.startsWith('cm-tag-'));
					return className ? className.replace('cm-tag-', '') : '';
				},
				shouldSkip: (element: HTMLDivElement) => {
					// Skip very short tags (likely partial while typing)
					const tagName = Array.from(element.classList).find(cls => cls.startsWith('cm-tag-'))?.replace('cm-tag-', '') || '';
					return tagName.length < 2; // Skip single character tags
				},
				isInlineTag: true, // Special flag to handle inline tags differently
			}
		];

		// Add embedded bases configurations if enabled
		if (this.settings.colorEmbeddedBases) {
			// Add list properties within embedded bases (only if list properties are also enabled)
			if (this.settings.colorListProperties) {
				propertyTypes.push({
					enabled: true, // Already checked both conditions above
					selector: '.internal-embed.bases-embed .multi-select-pill',
					getTextContent: (element: HTMLDivElement) => {
						const contentElement = element.querySelector('.multi-select-pill-content') as HTMLElement;
						return contentElement?.textContent || element.textContent || '';
					},
					shouldSkip: () => false,
				});
			}

			// Add formula properties within embedded bases (only if formula properties are also enabled)
			if (this.settings.colorFormulaProperties) {
				propertyTypes.push({
					enabled: true, // Already checked both conditions above
					selector: '.internal-embed.bases-embed div.bases-td[data-property^="formula"] > div.bases-rendered-value',
					getTextContent: (element: HTMLDivElement) => element.textContent?.trim() || '',
					shouldSkip: (element: HTMLDivElement) => {
						// Skip if this element contains an image (check multiple ways for robustness)
						if (element.querySelector('img') || 
						    element.querySelector('svg') || 
						    element.innerHTML.includes('<img') || 
						    element.innerHTML.includes('<svg') ||
						    element.classList.contains('has-image')) {
							// Remove any existing data attribute to prevent coloring
							element.removeAttribute('data-sanitized-content');
							return true;
						}
						return false;
					},
				});
			}
		}
		
		// Process each property type
		for (const propertyType of propertyTypes) {
			if (propertyType.enabled) {
				settingsChanged = this.processPropertyType(propertyType) || settingsChanged;
			}
		}
		
		if (settingsChanged) {
			this.saveSettings();
		}
	}

	private processPropertyType(config: {
		selector: string;
		getTextContent: (element: HTMLDivElement) => string;
		shouldSkip: (element: HTMLDivElement) => boolean;
		isInlineTag?: boolean;
	}): boolean {
		let settingsChanged = false;
		const processedProperties = new Set<string>(); // Track properties processed in this cycle
		
		document.querySelectorAll(config.selector).forEach((element: Element) => {
			const div = element as HTMLDivElement;
			
			// Check if this element should be skipped
			if (config.shouldSkip(div)) {
				return;
			}
			
			const textContent = config.getTextContent(div);
			
			// Skip if no meaningful text content
			if (!textContent || textContent.length === 0) {
				if (!config.isInlineTag) {
					div.removeAttribute('data-sanitized-content');
				}
				return;
			}
			
			const sanitized = textContent.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F+\-]/g, '');
			
			// For inline tags, we don't set data attributes since we target by class name
			if (!config.isInlineTag) {
				div.setAttribute('data-sanitized-content', sanitized);
			}
			
			// Skip if we've already processed this property in this cycle
			if (processedProperties.has(textContent)) {
				return;
			}
			processedProperties.add(textContent);
			
			if (!this.settings.pillColors.hasOwnProperty(textContent)) {
				const generatedColor = this.generateColorFromText(sanitized);
				this.settings.pillColors[textContent] = generatedColor;
				this.settings.pillEnabled[textContent] = true; // Enable by default
				settingsChanged = true;
				this.addColorRule(sanitized, generatedColor, config.isInlineTag);
			} else if (this.settings.pillColors[textContent]) {
				// Ensure enabled state exists for existing properties
				if (!this.settings.pillEnabled.hasOwnProperty(textContent)) {
					this.settings.pillEnabled[textContent] = true;
					settingsChanged = true;
				}
				// Only add color rule if property is enabled
				if (this.settings.pillEnabled[textContent] !== false) {
					this.addColorRule(sanitized, this.settings.pillColors[textContent], config.isInlineTag);
				}
			}
		});
		
		return settingsChanged;
	}

	setupViewportListener() {
		this.clearViewportListener();
		
		const targetElement = document.querySelector('.bases-view') || 
		                     document.querySelector('.workspace-leaf-content[data-type="file-properties"]') ||
		                     document.querySelector('.workspace-leaf-content[data-type="markdown"]') ||
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
			const shouldReprocess = mutations.some(mutation => {
				// Check for childList changes (new elements added)
				if (mutation.type === 'childList') {
					return Array.from(mutation.addedNodes).some((node: Node) => {
						if (node.nodeType !== Node.ELEMENT_NODE) return false;
						const element = node as Element;
						return element.classList?.contains('multi-select-pill') || 
						       element.querySelector?.('.multi-select-pill') ||
						       (element.classList?.contains('bases-rendered-value') && 
						        !element.querySelector('img') && 
						        !element.querySelector('svg') && 
						        !element.innerHTML.includes('<img') &&
						        !element.innerHTML.includes('<svg')) ||
						       element.querySelector?.('div.bases-td[data-property^="formula"] > div.bases-rendered-value') ||
						       // Watch for embedded bases
						       element.classList?.contains('internal-embed') ||
						       element.classList?.contains('bases-embed') ||
						       element.querySelector?.('.internal-embed.bases-embed');
						       // Note: Removed inline tag detection from mutation observer since we handle it via editor-change event
					});
				}
				
				return false;
			});
			
			if (shouldReprocess) {
				// Add a small delay to ensure DOM has fully settled after mutations
				setTimeout(() => this.processProperties(), 50);
			}
		});
		
		this.mutationObserver.observe(targetElement, { 
			childList: true, 
			subtree: true
		});
	}	clearMutationObserver() {
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
		
		if (this.editorChangeTimer) {
			clearTimeout(this.editorChangeTimer);
			this.editorChangeTimer = null;
		}
		
		if (this.contentElement && this.scrollEventRef) {
			this.contentElement.removeEventListener('scroll', this.scrollEventRef);
			this.scrollEventRef = null;
			this.contentElement = null;
		}
		
		this.clearMutationObserver();
	}
}
