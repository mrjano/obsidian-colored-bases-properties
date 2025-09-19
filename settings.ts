import { App, Modal, PluginSettingTab, Setting } from 'obsidian';
import type ColoredBasesPropertiesPlugin from './main';

export interface ColoredBasesPropertiesPluginSettings {
	pillColors: Record<string, string>;
	pillEnabled: Record<string, boolean>;
	colorListProperties: boolean;
	colorFormulaProperties: boolean;
	colorEmbeddedBases: boolean;
	colorInlineTags: boolean;
}

export const DEFAULT_SETTINGS: ColoredBasesPropertiesPluginSettings = {
	pillColors: {},
	pillEnabled: {},
	colorListProperties: true,
	colorFormulaProperties: false,
	colorEmbeddedBases: true,
	colorInlineTags: true
}



export class ColoredBasesPropertiesSettingTab extends PluginSettingTab {
	plugin: ColoredBasesPropertiesPlugin;

	constructor(app: App, plugin: ColoredBasesPropertiesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		// Convert any existing HSL values to hex format
		let settingsChanged = false;
		for (const [pillName, color] of Object.entries(this.plugin.settings.pillColors)) {
			if (color.startsWith('hsl(')) {
				const hexColor = this.hslToHex(color);
				this.plugin.settings.pillColors[pillName] = hexColor;
				settingsChanged = true;
			}
		}
		if (settingsChanged) {
			this.plugin.saveSettings();
		}

		new Setting(containerEl)
			.setName('Property types')
			.setHeading();

		// Toggle for list properties
		new Setting(containerEl)
			.setName('Color list properties')
			.setDesc('Enable coloring for list properties (multi-select pills)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.colorListProperties)
				.onChange(async (value) => {
					this.plugin.settings.colorListProperties = value;
					await this.plugin.saveSettings();
					
					// Update styles immediately
					if (value) {
						// Re-enable list property coloring
						this.plugin.processProperties();
					} else {
						// Disable list property coloring - will be handled in main.ts
						this.plugin.processProperties();
					}
				}));

		// Toggle for formula properties  
		new Setting(containerEl)
			.setName('Color formula properties')
			.setDesc('Enable coloring for formula properties (rendered values)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.colorFormulaProperties)
				.onChange(async (value) => {
					this.plugin.settings.colorFormulaProperties = value;
					await this.plugin.saveSettings();
					
					// Update styles immediately
					if (value) {
						// Enable formula property coloring
						this.plugin.processProperties();
					} else {
						// Disable formula property coloring - will be handled in main.ts
						this.plugin.processProperties();
					}
				}));

		// Toggle for embedded bases
		new Setting(containerEl)
			.setName('Color embedded bases')
			.setDesc('Enable coloring for properties within embedded bases (respects list and formula property settings)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.colorEmbeddedBases)
				.onChange(async (value) => {
					this.plugin.settings.colorEmbeddedBases = value;
					await this.plugin.saveSettings();
					
					// Update styles immediately
					if (value) {
						// Enable embedded bases property coloring
						this.plugin.processProperties();
					} else {
						// Disable embedded bases property coloring - will be handled in main.ts
						this.plugin.processProperties();
					}
				}));

		// Toggle for inline tags
		new Setting(containerEl)
			.setName('Color inline tags')
			.setDesc('Enable coloring for inline tags in markdown and reading mode')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.colorInlineTags)
				.onChange(async (value) => {
					this.plugin.settings.colorInlineTags = value;
					await this.plugin.saveSettings();
					
					// Update styles immediately
					if (value) {
						// Enable inline tags coloring
						this.plugin.processProperties();
					} else {
						// Disable inline tags coloring - will be handled in main.ts
						this.plugin.processProperties();
					}
				}));

		new Setting(containerEl)
			.setName('Property colors')
			.setHeading();

		// Clear all button
		if (Object.keys(this.plugin.settings.pillColors).length > 0) {
			new Setting(containerEl)
				.setName('Clear all')
				.setDesc('Remove all detected property values. Colors will be regenerated when you open a Bases file with properties.')
				.addButton(button => button
					.setButtonText('Clear all')
					.setCta()
					.onClick(async () => {
						// Clear all style rules first
						this.plugin.clearAllColorRules();
						// Clear settings
						this.plugin.settings.pillColors = {};
						await this.plugin.saveSettings();
						// Immediately reprocess to generate new colors
						setTimeout(() => {
							this.plugin.processProperties();
						}, 50);
						this.display(); // Refresh the settings display
					}));
		}
		
		const pillsContainer = containerEl.createDiv('pills-container');
		
		if (Object.keys(this.plugin.settings.pillColors).length === 0) {
			pillsContainer.createEl('p', {
				text: 'No property values detected yet. Open a Bases file with properties to automatically detect values.',
				cls: 'setting-item-description'
			});
		} else {
			Object.keys(this.plugin.settings.pillColors)
				.sort((a, b) => a.localeCompare(b))
				.forEach(pillName => {
					const pillValue = this.plugin.settings.pillColors[pillName];
					
					const setting = new Setting(pillsContainer);
					let colorPickerComponent: any = null;
					
					setting
						.addText(text => text
							.setPlaceholder('Enter color (e.g., #FF0000 or hsl(180, 50%, 40%))')
							.setValue(pillValue)
							.onChange(async (value) => {
								// Always save the input value to settings (even if invalid)
								this.plugin.settings.pillColors[pillName] = value;
								await this.plugin.saveSettings();
								
								// Only update visual elements if the color is valid
								if (value && this.isValidColor(value)) {
									// Update the style rule immediately
									this.plugin.updateColorRule(pillName, value);
									// Update the pill preview and color picker
									this.updatePillPreview(pillElement, pillName, value);
									if (colorPickerComponent) {
										colorPickerComponent.setValue(this.hslToHex(value));
									}
								}
							}))
						.addColorPicker(color => {
							colorPickerComponent = color;
							return color
								.setValue(this.hslToHex(pillValue))
								.onChange(async (value) => {
									// Update settings
									this.plugin.settings.pillColors[pillName] = value;
									await this.plugin.saveSettings();
									this.plugin.updateColorRule(pillName, value);
									// Update the text input and pill preview
									const textInput = setting.controlEl.querySelector('input[type="text"]') as HTMLInputElement;
									if (textInput) textInput.value = value;
									this.updatePillPreview(pillElement, pillName, value);
								})
						})
						.addExtraButton(button => button
							.setIcon('reset')
							.setTooltip('Restore default color')
							.onClick(async () => {
								// Generate the default color for this pill
								const sanitized = pillName.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F-]/g, '');
								const defaultColor = this.plugin.generateColorFromText(sanitized);
								
								// Update settings
								this.plugin.settings.pillColors[pillName] = defaultColor;
								await this.plugin.saveSettings();
								this.plugin.updateColorRule(pillName, defaultColor);
								
								// Update the text input, color picker, and pill preview
								const textInput = setting.controlEl.querySelector('input[type="text"]') as HTMLInputElement;
								if (textInput) textInput.value = defaultColor;
								if (colorPickerComponent) {
									colorPickerComponent.setValue(this.hslToHex(defaultColor));
								}
								this.updatePillPreview(pillElement, pillName, defaultColor);
							}))
						.addButton(button => button
							.setIcon('trash')
							.setTooltip('Delete this property value')
							.onClick(async () => {
								// Remove the style rule immediately
								const sanitized = pillName.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F-]/g, '');
								this.plugin.removeColorRule(sanitized);
								
								// Remove data attributes from matching elements so they can be reprocessed
								const listElements = document.querySelectorAll(`.multi-select-pill[data-sanitized-content="${sanitized}"]`);
								const formulaElements = document.querySelectorAll(`div.bases-td[data-property^="formula"] > div.bases-rendered-value[data-sanitized-content="${sanitized}"]`);
								listElements.forEach((element: Element) => {
									element.removeAttribute('data-sanitized-content');
								});
								formulaElements.forEach((element: Element) => {
									element.removeAttribute('data-sanitized-content');
								});
								
								// Remove from settings
								delete this.plugin.settings.pillColors[pillName];
								delete this.plugin.settings.pillEnabled[pillName];
								await this.plugin.saveSettings();
								this.display(); // Refresh the settings display
							}))
						.addToggle(toggle => toggle
							.setValue(this.plugin.settings.pillEnabled[pillName] ?? true)
							.setTooltip('Enable/disable coloring for this property')
							.onChange(async (value) => {
								this.plugin.settings.pillEnabled[pillName] = value;
								await this.plugin.saveSettings();
								
								// Update coloring immediately
								const sanitized = pillName.replace(/\s+/g, '').replace(/[^\w\u00C0-\u017F-]/g, '');
								if (value) {
									// Re-enable coloring
									const color = this.plugin.settings.pillColors[pillName];
									if (color) {
										this.plugin.addColorRule(sanitized, color, pillName);
									}
								} else {
									// Disable coloring
									this.plugin.removeColorRule(sanitized);
								}
							}));
					
					// Style the pill name with background color and rounded appearance
					const pillElement = this.setupPillPreview(setting, pillName, pillValue);
				});
		}
	}

	private setupPillPreview(setting: Setting, name: string, color: string): HTMLElement {
		// Insert pill at the beginning of the setting (left side)
		const pill = setting.settingEl.createSpan('property-pill-preview');
		pill.textContent = name;
		pill.style.backgroundColor = color;
		pill.style.color = 'white'; // Always use white text as specified
		pill.style.padding = '4px 12px';
		pill.style.borderRadius = '12px';
		pill.style.fontSize = '0.85em';
		pill.style.fontWeight = '500';
		pill.style.marginRight = '12px';
		pill.style.display = 'inline-block';
		
		// Insert at the beginning of the setting element
		setting.settingEl.insertBefore(pill, setting.settingEl.firstChild);
		
		return pill;
	}

	private updatePillPreview(pill: HTMLElement, name: string, color: string): void {
		pill.textContent = name;
		pill.style.backgroundColor = color;
		pill.style.color = 'white'; // Always use white text as specified
	}

	private hslToHex(hsl: string): string {
		// If already hex, return as-is
		if (hsl.startsWith('#')) {
			return hsl;
		}
		
		// If HSL, convert to hex
		if (hsl.startsWith('hsl(')) {
			const match = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
			if (match) {
				const h = parseInt(match[1]);
				const s = parseInt(match[2]) / 100;
				const l = parseInt(match[3]) / 100;
				
				const c = (1 - Math.abs(2 * l - 1)) * s;
				const x = c * (1 - Math.abs((h / 60) % 2 - 1));
				const m = l - c / 2;
				
				let r = 0, g = 0, b = 0;
				
				if (h >= 0 && h < 60) {
					r = c; g = x; b = 0;
				} else if (h >= 60 && h < 120) {
					r = x; g = c; b = 0;
				} else if (h >= 120 && h < 180) {
					r = 0; g = c; b = x;
				} else if (h >= 180 && h < 240) {
					r = 0; g = x; b = c;
				} else if (h >= 240 && h < 300) {
					r = x; g = 0; b = c;
				} else if (h >= 300 && h < 360) {
					r = c; g = 0; b = x;
				}
				
				r = Math.round((r + m) * 255);
				g = Math.round((g + m) * 255);
				b = Math.round((b + m) * 255);
				
				return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
			}
		}
		
		// Fallback - return as-is
		return hsl;
	}

	private isValidColor(color: string): boolean {
		if (!color || color.trim() === '') {
			return false;
		}
		
		color = color.trim();
		
		// Check for valid hex color (3 or 6 digits, with or without #)
		const hexRegex = /^#?([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/;
		if (hexRegex.test(color)) {
			return true;
		}
		
		// Check for valid HSL color
		const hslRegex = /^hsl\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)$/;
		const hslMatch = color.match(hslRegex);
		if (hslMatch) {
			const h = parseInt(hslMatch[1]);
			const s = parseInt(hslMatch[2]);
			const l = parseInt(hslMatch[3]);
			// Check if values are in valid ranges
			return h >= 0 && h <= 360 && s >= 0 && s <= 100 && l >= 0 && l <= 100;
		}
		
		// Check for valid CSS color names (basic validation)
		const cssColorNames = [
			'red', 'green', 'blue', 'white', 'black', 'yellow', 'cyan', 'magenta',
			'orange', 'purple', 'pink', 'brown', 'gray', 'grey', 'transparent'
		];
		if (cssColorNames.includes(color.toLowerCase())) {
			return true;
		}
		
		return false;
	}

	private hexToHsl(hex: string): string {
		// Remove # if present
		hex = hex.replace('#', '');
		
		// Parse r, g, b values
		const r = parseInt(hex.substring(0, 2), 16) / 255;
		const g = parseInt(hex.substring(2, 4), 16) / 255;
		const b = parseInt(hex.substring(4, 6), 16) / 255;
		
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		let h = 0, s = 0, l = (max + min) / 2;
		
		if (max === min) {
			h = s = 0; // achromatic
		} else {
			const d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
			
			switch (max) {
				case r: h = (g - b) / d + (g < b ? 6 : 0); break;
				case g: h = (b - r) / d + 2; break;
				case b: h = (r - g) / d + 4; break;
			}
			h /= 6;
		}
		
		return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
	}


}
