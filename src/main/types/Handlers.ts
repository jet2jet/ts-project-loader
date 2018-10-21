
/**
 * The handler objecct for events and loggings
 * @internal
 */
export default interface Handlers {
	/**
	 * Called when an error occurs. If this method is not implemented,
	 * the error object will be 'thrown'. On the other hand, the error
	 * will not be thrown if this method is implemented and no errors are
	 * thrown from the method.
	 * @param isWatching true if the watch process is running
	 * @param message an error message (used for 'console.error' or etc.)
	 * @param error an error object.
	 *     - If the error is from TypeScript compilation, 'error' will be a TypeScriptError object.
	 *     - If the error is from webpack process, 'error' will be a WebpackError object.
	 */
	handleError?(isWatching: boolean, message: string, error: Error): void;
	/**
	 * Called when an usual log message is outputted.
	 * @param message a message
	 * @param details a detail object for the message if available
	 */
	logInfo?(message: string, details?: any): void;
	/**
	 * Called when a verbose log message is outputted.
	 * Note that this method is never called unless 'verbose' is true.
	 * @param message a message
	 * @param details a detail object for the message if available
	 */
	logVerbose?(message: string, details?: any): void;
}
