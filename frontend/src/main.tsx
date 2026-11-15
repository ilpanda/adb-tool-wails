import React from 'react'
import {createRoot} from 'react-dom/client'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './style.css'
import App from './App'
import {initializeLanguage} from './i18n'

const container = document.getElementById('root')

const root = createRoot(container!)

initializeLanguage().then(() => root.render(
    <React.StrictMode>
        <App/>
    </React.StrictMode>
)).catch(error => {
    console.error('Unable to initialize language', error);
    root.render(<App/>);
})
