import { handleDnsCallback } from '../../server/dns-oauth.mjs';

export const onRequestGet = ({ request, env }) => handleDnsCallback(request, env);
