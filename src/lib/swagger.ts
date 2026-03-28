import swaggerJsDoc from "swagger-jsdoc";
import swaggerUI from "swagger-ui-express";

const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Whatsapp API',
            version: '0.1.0',
            description: 'API for sending and receiving whatsapp messages'
        },
        servers: [
            {
                url: 'http://localhost:3000',
                description: 'Local development server'
            }
        ],
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'x-api-key'
                }
            }
        }
    },
    apis: ['./src/routes/*.ts', './src/index.ts']
}

const swaggerDocs = swaggerJsDoc(swaggerOptions)

export { swaggerDocs, swaggerUI }