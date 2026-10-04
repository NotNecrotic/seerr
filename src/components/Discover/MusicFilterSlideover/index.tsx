import Button from '@app/components/Common/Button';
import SlideOver from '@app/components/Common/SlideOver';
import { useUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';

/**
 * Release types MusicBrainz records as `primarytype`, mapped to the values its search
 * API accepts.
 */
const RELEASE_TYPES = [
  'album',
  'single',
  'ep',
  'compilation',
  'live',
  'remix',
  'soundtrack',
  'mixtape/street',
] as const;

const messages = defineMessages('components.Discover.MusicFilterSlideover', {
  filters: 'Filters',
  clearfilters: 'Clear Active Filters',
  genre: 'Genre / Tag',
  genreplaceholder: 'e.g. trip hop',
  country: 'Country',
  countryplaceholder: 'e.g. GB',
  label: 'Label',
  labelplaceholder: 'e.g. Warp Records',
  releaseType: 'Release Type',
  releaseDate: 'Release Date',
  from: 'From',
  to: 'To',
  apply: 'Apply Filters',
  alltypes: 'All Types',
});

interface Props {
  show: boolean;
  onClose: () => void;
  currentFilters: {
    genre?: string;
    country?: string;
    label?: string;
    releaseType?: string;
    releaseDateGte?: string;
    releaseDateLte?: string;
  };
}

const FILTER_KEYS = [
  'genre',
  'country',
  'label',
  'releaseType',
  'releaseDateGte',
  'releaseDateLte',
] as const;

const DateRangeFilters = ({
  currentFilters,
  inputClass,
  setParam,
}: {
  currentFilters: Props['currentFilters'];
  inputClass: string;
  setParam: (key: string, value: string) => void;
}) => {
  const intl = useIntl();

  return (
    <div>
      <span className="text-label">
        {intl.formatMessage(messages.releaseDate)}
      </span>
      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="releaseDateGte" className="text-sm text-gray-400">
            {intl.formatMessage(messages.from)}
          </label>
          <input
            id="releaseDateGte"
            type="text"
            inputMode="numeric"
            className={inputClass}
            placeholder="1990"
            defaultValue={currentFilters.releaseDateGte ?? ''}
            onBlur={(e) => setParam('releaseDateGte', e.target.value.trim())}
          />
        </div>
        <div>
          <label htmlFor="releaseDateLte" className="text-sm text-gray-400">
            {intl.formatMessage(messages.to)}
          </label>
          <input
            id="releaseDateLte"
            type="text"
            inputMode="numeric"
            className={inputClass}
            placeholder="2000"
            defaultValue={currentFilters.releaseDateLte ?? ''}
            onBlur={(e) => setParam('releaseDateLte', e.target.value.trim())}
          />
        </div>
      </div>
    </div>
  );
};

/**
 * Music filter slideover.
 *
 * Deliberately separate from the TMDB-backed `FilterSlideover`: its selectors load
 * genres, studios, and keywords from TMDB, none of which exist for MusicBrainz. These
 * are free-text and native-select controls that map onto MusicBrainz search fields
 * instead.
 */
const MusicFilterSlideover = ({ show, onClose, currentFilters }: Props) => {
  const intl = useIntl();
  const updateQueryParams = useUpdateQueryParams({});

  if (!show) {
    return null;
  }

  const setParam = (key: string, value: string) => {
    // An empty input should clear the filter rather than sending a blank value
    // upstream, where it would become a meaningless Lucene clause.
    updateQueryParams(key, value === '' ? undefined : value);
  };

  const inputClass =
    'block w-full rounded-md border border-gray-600 bg-gray-900/80 px-3 py-2 text-white placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-0';

  return (
    <SlideOver
      show={show}
      onClose={onClose}
      title={intl.formatMessage(messages.filters)}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="genre" className="text-label">
            {intl.formatMessage(messages.genre)}
          </label>
          <input
            id="genre"
            type="text"
            className={`mt-2 ${inputClass}`}
            placeholder={intl.formatMessage(messages.genreplaceholder)}
            defaultValue={currentFilters.genre ?? ''}
            onBlur={(e) => setParam('genre', e.target.value.trim())}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="country" className="text-label">
              {intl.formatMessage(messages.country)}
            </label>
            <input
              id="country"
              type="text"
              className={`mt-2 ${inputClass}`}
              placeholder={intl.formatMessage(messages.countryplaceholder)}
              defaultValue={currentFilters.country ?? ''}
              onBlur={(e) => setParam('country', e.target.value.trim())}
            />
          </div>
          <div>
            <label htmlFor="label" className="text-label">
              {intl.formatMessage(messages.label)}
            </label>
            <input
              id="label"
              type="text"
              className={`mt-2 ${inputClass}`}
              placeholder={intl.formatMessage(messages.labelplaceholder)}
              defaultValue={currentFilters.label ?? ''}
              onBlur={(e) => setParam('label', e.target.value.trim())}
            />
          </div>
        </div>
        <div>
          <label htmlFor="releaseType" className="text-label">
            {intl.formatMessage(messages.releaseType)}
          </label>
          <select
            id="releaseType"
            className={`mt-2 ${inputClass}`}
            defaultValue={currentFilters.releaseType ?? ''}
            onChange={(e) => setParam('releaseType', e.target.value)}
          >
            <option value="">{intl.formatMessage(messages.alltypes)}</option>
            {RELEASE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <DateRangeFilters
          currentFilters={currentFilters}
          inputClass={inputClass}
          setParam={setParam}
        />
      </div>
      <div className="mt-6 flex items-center justify-between">
        <Button
          buttonType="ghost"
          onClick={() =>
            FILTER_KEYS.forEach((key) => updateQueryParams(key, undefined))
          }
        >
          {intl.formatMessage(messages.clearfilters)}
        </Button>
        <Button buttonType="primary" onClick={onClose}>
          {intl.formatMessage(messages.apply)}
        </Button>
      </div>
    </SlideOver>
  );
};

export default MusicFilterSlideover;
