interface PlaceholderProps {
  canExpand?: boolean;
  /**
   * Card shape. Music art is square while movie and TV posters are vertical, so this
   * keeps loading and empty states the same shape as the loaded card.
   */
  aspect?: 'poster' | 'square';
}

const Placeholder = ({
  canExpand = false,
  aspect = 'poster',
}: PlaceholderProps) => {
  return (
    <div
      className={`relative animate-pulse rounded-xl bg-gray-700 ${
        aspect === 'square' ? 'w-32 sm:w-40 md:w-48' : 'w-36 sm:w-36 md:w-44'
      } ${canExpand ? 'w-full' : ''}`}
    >
      {/* Square art has no wasted vertical space, so it fills the box outright. */}
      <div
        className="w-full"
        style={{ paddingBottom: aspect === 'square' ? '100%' : '150%' }}
      />
    </div>
  );
};

export default Placeholder;
