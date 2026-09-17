import { CONFIG } from './config.js';

const ONLINE_API_ROOT = CONFIG.onlineApiUrl || '/api/online';

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, value);
    }
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

export class OnlineService {
  async #request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${ONLINE_API_ROOT}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let message = `Online service error (${response.status}).`;
      try {
        const payload = await response.json();
        if (typeof payload.error === 'string' && payload.error) {
          message = payload.error;
        }
      } catch {
        // Keep fallback message.
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  upsertPlayer({ playerId, name }) {
    return this.#request('/players', {
      method: 'POST',
      body: { playerId, name },
    });
  }

  getLobby(playerId) {
    return this.#request(`/lobby${buildQuery({ playerId })}`);
  }

  createMatch({ playerId, name }) {
    return this.#request('/matches', {
      method: 'POST',
      body: { playerId, name },
    });
  }

  getMatch(matchId, playerId) {
    return this.#request(`/matches/${matchId}${buildQuery({ playerId })}`);
  }

  joinMatch(matchId, playerId) {
    return this.#request(`/matches/${matchId}/join`, {
      method: 'POST',
      body: { playerId },
    });
  }

  moveMatch(matchId, playerId, move) {
    return this.#request(`/matches/${matchId}/move`, {
      method: 'POST',
      body: { playerId, move },
    });
  }

  createTournament({ playerId, name }) {
    return this.#request('/tournaments', {
      method: 'POST',
      body: { playerId, name },
    });
  }

  getTournament(tournamentId, playerId) {
    return this.#request(`/tournaments/${tournamentId}${buildQuery({ playerId })}`);
  }

  joinTournament(tournamentId, playerId) {
    return this.#request(`/tournaments/${tournamentId}/join`, {
      method: 'POST',
      body: { playerId },
    });
  }

  moveTournamentMatch(tournamentId, matchId, playerId, move) {
    return this.#request(`/tournaments/${tournamentId}/matches/${matchId}/move`, {
      method: 'POST',
      body: { playerId, move },
    });
  }
}
