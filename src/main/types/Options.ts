
import * as ts from 'typescript';

/**
 * Loader options
 */
export default interface Options {
	/**
	 * Specifies the TypeScript project file (such as tsconfig.json) or the directory path.
	 * If omitted, tsconfig.json will be searched from the directory of input TypeScript file.
	 *
	 * Either 'configFile' or 'configFileName' can be specified; both cannot be specified.
	 * ('configFileName' is an alias of 'configFile'.)
	 */
	configFile?: string | undefined;
	/**
	 * Specifies the TypeScript project file (such as tsconfig.json) or the directory path.
	 * If omitted, tsconfig.json will be searched from the directory of input TypeScript file.
	 *
	 * Either 'configFile' or 'configFileName' can be specified; both cannot be specified.
	 * ('configFileName' is an alias of 'configFile'.)
	 */
	configFileName?: string | undefined;
	/**
	 * Temporal output directory for emitted JS files from TypeScript compiler.
	 * If not specified, JS files are not emitted onto the real file systm.
	 */
	tempBuildDir?: string | undefined;
	/** The locale/language for TypeScript messages [default: (unspecified)] */
	locale?: string | undefined;
	/**
	 * An object containing handlers for events and loggings. [default: (none)]
	 * To output logs, handlers must be specified.
	 */
	logger?: {
		/**
		 * Called when an usual log message is outputted.
		 * @param message a message
		 * @param details a detail object for the message if available
		 */
		logInfo?(message: string, details?: any): void;
		/**
		 * Called when a verbose log message is outputted.
		 * @param message a message
		 * @param details a detail object for the message if available
		 */
		logVerbose?(message: string, details?: any): void;
	};
	/**
	 * Suppress logs from the loader. If true, the methods in 'logger' are not called.
	 */
	silent?: boolean;
	/**
	 * Outputs the loader version on the first initialization. Ignored if 'silent' is true.
	 */
	showVersion?: boolean;
	/**
	 * Specifies true if using module resolution method from TypeScript only.
	 * By default, the plugin uses enhanced-resolve with webpack configuration for module resolution.
	 */
	useTsModuleResolution?: boolean | undefined;
	/**
	 * Additional compiler options for TypeScript files.
	 * This overrides the options in the config file.
	 *
	 * NOTE: For the purpose of this loader, you cannot specify additional options per files;
	 * otherwise an unexpected behavior may occur.
	 */
	compilerOptions?: ts.CompilerOptions;
}
