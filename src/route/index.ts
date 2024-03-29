import express from 'express';
import * as Controllers from '../controller';
import apiWrapper from '../lib/apiWrapper';

const METHOD_METADATA = 'method';
const PATH_METADATA = 'path';

/**
 * A class for building and managing routes.
 */
export default class Router {
    private routeMap: any;
    private router: any;
    constructor() {
        this.router = express.Router();
        this.routeMap = this.buildRoute();
        this.router['get']('/path', (req, res) => res.send(this.pathToTable()));
    }

    /**
     * Builds the routes for the router.
     * @param {Object} Controllers - An object containing all the controllers.
     * @returns {Object[]} An array of route objects. Each object has the following properties:
     *                    - method: The HTTP method of the route.
     *                    - path: The path of the route.
     *                    - handler: The handler function for the route.
     *                    - controller: The name of the controller that the route belongs to.
     */
    buildRoute() {
        return Object.values(Controllers)
            .map(Controller => {
                const controllerInstance = new Controller();
                const routes = Reflect.getMetadata('ROUTERS', Controller);
                return routes.map(({ method, path, handler }) => {
                    const resolver = apiWrapper(controllerInstance[handler].bind(controllerInstance));
                    this.router[method](path, resolver);
                    return {
                        method,
                        path,
                        handler,
                        controller: Controller.name
                    };
                });
            })
            .flat();
    }

    /**
     * Logs the routes.
     * @returns {void}
     */
    log() {
        console.table(this.routeMap);
    }

    pathToTable() {
        const table = `<table><thead><tr><th>Method</th><th>Path</th><th>Handler</th><th>Controller</th></tr></thead><tbody>`;
        const rows = this.routeMap.map(item => {
            return `<tr><td>${item.method}</td><td>${item.path}</td><td>${item.handler}</td><td>${item.controller}</td></tr>`;
        });
        const html = `${table}${rows.join('')}</tbody></table>`;
        return html
    }

    /**
     * Gets the router instance.
     * @returns {any} The router instance.
     */
    get route() {
        return this.router;
    }
}
